// /api/brief — generates the daily personalized brief.
//
// Architecture: 3-tier cache + 2-layer generation.
//
//   Tier 1: brief-full (today + holdings hash) — instant return on cache hit.
//   Tier 2: layer-a (today) — fast Layer B regen using cached market data.
//   Tier 3: full legacy generation — slow, last-resort cold path.
//
//   Layer A = market data (cron-cached, NOT user-specific):
//             market_pulse, todays_edge_market, smart_money, radar_candidates
//   Layer B = user-specific (regenerated when holdings change, NO web search):
//             affirmation, mindset, clarity, power_plate, decisions,
//             conviction_watch, opportunity_watch
//
// HARDENING (vs the previous version):
//   - Single source of truth for "is this content populated" — hasSmartMoneyContent
//     and hasMarketPulseContent. Both reads AND writes use these so a partial
//     LLM response (smart_money block exists but all arrays empty) is never
//     cached and never served from cache.
//   - Input validation on POST body. Symbols regex-validated, message lengths
//     capped, holdings capped to 200, prompt-injection-resistant.
//   - Rate limiting via Upstash INCR — 60 req/hr per IP. Silently disabled
//     when Upstash isn't configured (local dev).
//   - Retry wrapper on Anthropic calls — one retry on transient/5xx errors.
//   - Request-ID logging for every request so cron and brief calls can be
//     correlated in Vercel logs.
//   - cacheWriteUserState validates inputs before writing (the cron reads
//     this — preventing poisoning is critical).
//   - formatHoldingsBlock labels cost as "$X.XX/share avg cost" so the LLM
//     never reads $5.99 as a total dollar value for a 175-share position.
//   - Dead buildPrompt function (250 lines, unused since Layer A/B split) removed.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Cache configuration ────────────────────────────────────────────
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = Math.floor(CACHE_TTL_MS / 1000);
const LAYER_A_TTL_SECONDS = 30 * 60 * 60;
const FULL_BRIEF_TTL_SECONDS = 30 * 60 * 60;
const USER_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

// L1 in-memory cache (dies on cold starts; L2 Upstash backs it up)
const briefCache = new Map<string, { brief: any; storedAt: number }>();

// ─── Upstash client (graceful degradation if not configured) ────────
let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) redis = new Redis({ url, token });
} catch (err) {
  console.warn("Brief: Upstash init failed; in-memory only:", err);
  redis = null;
}

// ─── Content validation — single source of truth ────────────────────
// Used in BOTH cache reads and cache writes. The old version validated
// only on read (line 53, 60, 527, 536), which left the door open to
// writing empty content into cache. Now writes refuse to persist any
// brief whose smart_money block has all-empty arrays.

function hasSmartMoneyContent(sm: any): boolean {
  if (!sm || typeof sm !== "object") return false;
  const whaleN = Array.isArray(sm.whale_moves) ? sm.whale_moves.length : 0;
  const congressN = Array.isArray(sm.congress_moves) ? sm.congress_moves.length : 0;
  const hedgeN = Array.isArray(sm.hedge_fund_moves) ? sm.hedge_fund_moves.length : 0;
  return (whaleN + congressN + hedgeN) > 0;
}

function hasMarketPulseContent(mp: any): boolean {
  if (!mp || typeof mp !== "object") return false;
  if (typeof mp.summary !== "string" || mp.summary.length < 5) return false;
  return true;
}

// A brief is "cacheable" when its smart_money block has at least one
// real move. This is the gating function for ALL cache writes.
function briefIsCacheable(brief: any): boolean {
  return hasSmartMoneyContent(brief?.smart_money);
}

// ─── Input validation ──────────────────────────────────────────────
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_WATCHLIST = 50;
const MAX_HOLDINGS = 200;
const MAX_ACCOUNTS = 20;
const MAX_NAME_CHARS = 80;
const MAX_DATE_CHARS = 60;
const MAX_ACCOUNT_NAME_CHARS = 80;

interface ValidatedHolding {
  symbol: string;
  qty?: number;
  cost?: number;
  value?: number;
  gainPct?: number;
  accountId?: string;
}
interface ValidatedAccount {
  id: string;
  name: string;
  brokerage?: string;
}
interface ValidatedRequestBody {
  name: string;
  watchlist: string[];
  holdings: ValidatedHolding[];
  accounts: ValidatedAccount[];
  holdingsAgeDays: number | null;
  date: string;
  forceFresh: boolean;
}

function clampString(v: any, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

function validateBody(raw: any): { ok: true; body: ValidatedRequestBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body" };

  const name = clampString(raw.name, MAX_NAME_CHARS);

  const rawWatch = Array.isArray(raw.watchlist) ? raw.watchlist : [];
  const watchlist = Array.from(
    new Set(
      rawWatch
        .map((s: any) => (typeof s === "string" ? s.toUpperCase() : ""))
        .filter((s: string) => SYMBOL_RE.test(s))
    )
  ).slice(0, MAX_WATCHLIST);

  const rawHoldings = Array.isArray(raw.holdings) ? raw.holdings : [];
  const holdings: ValidatedHolding[] = [];
  for (const h of rawHoldings.slice(0, MAX_HOLDINGS)) {
    if (!h || typeof h !== "object") continue;
    const symbol = typeof h.symbol === "string" ? h.symbol.toUpperCase() : "";
    if (!SYMBOL_RE.test(symbol)) continue; if (!Number.isFinite(h.qty) || Number(h.qty) <= 0) continue;
    holdings.push({
      symbol,
      qty: Number.isFinite(h.qty) ? Number(h.qty) : undefined,
      cost: Number.isFinite(h.cost) ? Number(h.cost) : undefined,
      value: Number.isFinite(h.value) ? Number(h.value) : undefined,
      gainPct: Number.isFinite(h.gainPct) ? Number(h.gainPct) : undefined,
      accountId: typeof h.accountId === "string" ? h.accountId.slice(0, 40) : undefined,
    });
  }

  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const accounts: ValidatedAccount[] = [];
  for (const a of rawAccounts.slice(0, MAX_ACCOUNTS)) {
    if (!a || typeof a !== "object") continue;
    if (typeof a.id !== "string") continue;
    accounts.push({
      id: a.id.slice(0, 40),
      name: clampString(a.name, MAX_ACCOUNT_NAME_CHARS) || "Account",
      brokerage: clampString(a.brokerage, 40),
    });
  }

  const holdingsAgeDays = Number.isFinite(raw.holdingsAgeDays)
    ? Math.max(0, Math.floor(Number(raw.holdingsAgeDays)))
    : null;

  const date = clampString(raw.date, MAX_DATE_CHARS);

  return {
    ok: true,
    body: {
      name,
      watchlist: watchlist as string[],
      holdings,
      accounts,
      holdingsAgeDays,
      date,
      forceFresh: !!raw.forceFresh,
    },
  };
}

// ─── Rate limiting ─────────────────────────────────────────────────
const BRIEF_RATE_LIMIT = 60;     // per IP per hour
const BRIEF_RATE_WINDOW = 3600;  // seconds

async function checkRateLimit(req: Request): Promise<{ ok: boolean; retryAfter: number }> {
  if (!redis) return { ok: true, retryAfter: 0 };
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const key = `ratelimit:brief:${ip}:${Math.floor(Date.now() / 1000 / BRIEF_RATE_WINDOW)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, BRIEF_RATE_WINDOW);
    if (count > BRIEF_RATE_LIMIT) return { ok: false, retryAfter: BRIEF_RATE_WINDOW };
  } catch (err) {
    console.warn("Brief rate limit check failed:", err);
  }
  return { ok: true, retryAfter: 0 };
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function holdingsHash(holdings: any[]): string {
  const fp = (holdings || [])
    .map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`)
    .sort()
    .join(",");
  return crypto.createHash("sha256").update(fp).digest("hex").slice(0, 16);
}

// ─── L1+L2 brief cache ─────────────────────────────────────────────
// Read path validates content via briefIsCacheable BEFORE returning.
async function cacheReadBrief(cacheKey: string): Promise<any | null> {
  const memHit = briefCache.get(cacheKey);
  if (memHit && Date.now() - memHit.storedAt < CACHE_TTL_MS && briefIsCacheable(memHit.brief)) {
    return memHit.brief;
  }
  if (!redis) return null;
  try {
    const kvHit = await redis.get<any>(`brief:${cacheKey}`);
    if (kvHit && briefIsCacheable(kvHit.brief)) {
      briefCache.set(cacheKey, { brief: kvHit.brief, storedAt: Date.now() });
      return kvHit.brief;
    }
  } catch (err) {
    console.warn("Upstash read failed:", err);
  }
  return null;
}

// Write path GATES on briefIsCacheable. Empty briefs never get cached.
async function cacheWriteBrief(cacheKey: string, brief: any): Promise<void> {
  if (!briefIsCacheable(brief)) {
    console.warn("Brief cache write skipped — content empty");
    return;
  }
  briefCache.set(cacheKey, { brief, storedAt: Date.now() });
  if (briefCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of briefCache.entries()) {
      if (now - v.storedAt > CACHE_TTL_MS) briefCache.delete(k);
    }
  }
  if (!redis) return;
  try {
    await redis.set(`brief:${cacheKey}`, { brief, storedAt: Date.now() }, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn("Upstash brief write failed:", err);
  }
}

// ─── Layer A / Layer B / user-state cache ──────────────────────────
async function cacheReadLayerA(date: string): Promise<any | null> {
  if (!redis) return null;
  try {
    const layerA = await redis.get<any>(`layer-a:${date}`);
    if (layerA && hasMarketPulseContent(layerA.market_pulse) && hasSmartMoneyContent(layerA.smart_money)) {
      return layerA;
    }
    return null;
  } catch (err) {
    console.warn("Upstash layer-a read failed:", err);
    return null;
  }
}

async function cacheWriteLayerA(date: string, data: any): Promise<void> {
  if (!redis) return;
  if (!hasMarketPulseContent(data?.market_pulse) || !hasSmartMoneyContent(data?.smart_money)) {
    console.warn("Layer-A cache write skipped — content empty");
    return;
  }
  try {
    await redis.set(`layer-a:${date}`, data, { ex: LAYER_A_TTL_SECONDS });
  } catch (err) {
    console.warn("Upstash layer-a write failed:", err);
  }
}

async function cacheReadFullBrief(date: string, hash: string): Promise<any | null> {
  if (!redis) return null;
  try {
    const full = await redis.get<any>(`brief-full:${date}:${hash}`);
    if (full && briefIsCacheable(full)) return full;
    return null;
  } catch (err) {
    console.warn("Upstash full-brief read failed:", err);
    return null;
  }
}

async function cacheWriteFullBrief(date: string, hash: string, brief: any): Promise<void> {
  if (!redis) return;
  if (!briefIsCacheable(brief)) {
    console.warn("Full-brief cache write skipped — content empty");
    return;
  }
  try {
    await redis.set(`brief-full:${date}:${hash}`, brief, { ex: FULL_BRIEF_TTL_SECONDS });
  } catch (err) {
    console.warn("Upstash full-brief write failed:", err);
  }
}

// User state is what the cron job picks up. Already validated before
// being passed in here, but defense-in-depth.
async function cacheWriteUserState(state: ValidatedRequestBody): Promise<void> {
  if (!redis) return;
  try {
    const sanitized = {
      name: state.name,
      watchlist: state.watchlist,
      holdings: state.holdings,
      accounts: state.accounts,
      holdingsAgeDays: state.holdingsAgeDays,
      date: state.date,
      savedAt: Date.now(),
    };
    await redis.set("latest-user-state", sanitized, { ex: USER_STATE_TTL_SECONDS });
  } catch (err) {
    console.warn("Upstash user-state write failed:", err);
  }
}

// Side effect: when Tier 3 generates a full brief, extract the Layer A
// slice so subsequent same-day CSV updates get the fast Tier 2 path.
function extractLayerAFromBrief(brief: any): any | null {
  if (!brief) return null;
  const slice: any = {
    generatedAt: new Date().toISOString(),
    fromTier3: true,
  };
  if (brief.market_pulse) slice.market_pulse = brief.market_pulse;
  if (brief.smart_money) slice.smart_money = brief.smart_money;
  if (Array.isArray(brief.radar_watch)) slice.radar_candidates = brief.radar_watch;
  if (brief.todays_edge) {
    slice.todays_edge_market = {
      binary_catalysts: brief.todays_edge.binary_catalysts || [],
      risk_flags: brief.todays_edge.risk_flags || [],
    };
  }
  return (hasMarketPulseContent(slice.market_pulse) && hasSmartMoneyContent(slice.smart_money)) ? slice : null;
}

// ─── Anthropic call helpers ────────────────────────────────────────
// Retry wrapper — one retry on transient/5xx errors. Schema/4xx fail fast.
async function callWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const transient = !status || status >= 500 || status === 429;
    if (!transient) throw err;
    console.warn(`Brief ${label}: transient error, retrying once:`, err?.message || err);
    await new Promise((r) => setTimeout(r, 1500));
    return await fn();
  }
}

const COMMON_PREAMBLE = (name: string, date: string) =>
  `You are a JSON generator. Output ONLY a single valid JSON object — no prose, no markdown, no code fences. Start with { and end with }.

Generate part of a morning briefing for ${name || "the user"} on ${date}. The reader is a sophisticated multi-account swing trader who knows technical analysis, smart-money signals (13F, STOCK Act, Form 4s), and macro catalysts. No beginner advice. No filler. They invest in: AI infrastructure, semiconductors, quantum computing, crypto-mining-to-HPC, nuclear, rare earths, and speculative biotech. CRITICAL TICKER ACCURACY: Never guess company names from tickers. When in doubt, write ONLY the ticker symbol. SMMT = Summit Therapeutics (biotech), NOT Summit Materials. CIFR = Cipher Mining. APLD = Applied Digital. USAR = USA Rare Earth. SMR = NuScale. IREN = Iris Energy. PLTR = Palantir. CRWV = CoreWeave.

CRITICAL — NO CONDITIONAL ADVICE / NO HOMEWORK:
- This app does the research FOR the user. NEVER write "if X then do A, else do B" — pick one path and commit.
- NEVER tell the user to "check Form 4s," "verify with broker," "see if any insider sold," "reassess the thesis," "wait for confirmation," or any phrase that asks the user to look something up before acting. They are paying you to look it up.
- If web_search is available and you genuinely need data to decide: use it, then write the unconditional recommendation. If web_search is NOT available and you don't have the data, OMIT the recommendation entirely rather than hedging.
- Every action field must be a single concrete trade: "Trim 15 sh of QCOM at $200" — NOT "Trim 10-15 sh depending on insider activity."
- Every why_now / deep_reasoning string must end with a clear directional read, not a checklist of things the user should investigate.

RISK TIER LANGUAGE — when describing a position or candidate, label it as LOWER / MEDIUM / HIGHER risk in plain English somewhere in the reasoning:
- LOWER RISK = large-cap, profitable, established (MSFT, GOOGL, VOO, GE).
- MEDIUM RISK = small-to-mid cap, real revenue + cash, but can swing 20-30% (IONQ, IREN, USAR, CRWV, LAES).
- HIGHER RISK = micro-cap, speculative, dilution risk, lottery money only (MOBX, PRSO, AMPX).

AGGRESSIVE DISCOVERY POSTURE — when surfacing radar/opportunity candidates, lean AGGRESSIVE, not conservative. Include sub-$300M micro-caps with real catalysts (M&A, LOI, defense contracts, rare-earth wins). The $300M cap floor is BANNED — that filter previously missed MOBX before its 80%+ pop on the SPD rare-earth LOI on 5/14/26. Do not retreat to mega-cap "safer" alternatives unless explicitly required.
`;

async function callJsonChunk(
  prompt: string,
  opts: { search?: boolean; maxTokens?: number; maxSearches?: number; model?: string; label?: string } = {}
) {
  const { search = false, maxTokens = 2500, maxSearches = 3, model = "claude-sonnet-4-5", label = "chunk" } = opts;
  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      ...(search
        ? {
            tools: [
              { type: "web_search_20250305", name: "web_search", max_uses: maxSearches } as any,
            ],
          }
        : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    label
  );
  const textBlocks = response.content.filter((b: any) => b.type === "text");
  const rawText = textBlocks.map((b: any) => b.text || "").join("\n");
  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON object");
  return stripCiteTags(JSON.parse(cleaned.slice(start, end + 1)));
}

// Strip <cite> tags injected by web_search; they leak into JSON strings.
function stripCiteTags<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
      .replace(/<\/?cite\b[^>]*>/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim() as any;
  }
  if (Array.isArray(value)) return value.map((v) => stripCiteTags(v)) as any;
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = stripCiteTags(v);
    return out;
  }
  return value;
}

// ─── Layer A generators (web search; not user-specific) ────────────
async function generateLayerAMarket(name: string, tickers: string, date: string): Promise<any> {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, macro events, and any earnings/FDA/catalysts in the next 1-2 weeks. Watchlist for context: ${tickers}.

Return ONLY this JSON:

{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each — index futures, VIX, key commodities, sector rotation, today's catalysts"]
  },
  "todays_edge_market": {
    "binary_catalysts": [ { "ticker": "TICKER", "event": "event date", "context": "max 12 words" } ],
    "risk_flags": [ { "ticker": "TICKER", "flag": "max 12 words", "suggested_action": "max 12 words" } ]
  },
  "radar_candidates": [
    {
      "ticker": "TICKER",
      "theme": "short tag e.g. 'Nuclear · AI energy'",
      "headline": "max 14 words",
      "why_now": "max 18 words",
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Explain WHY this stock matters right now, WHY IT'S WORTH WATCHING, HOW IT FITS thematic interests, and WHAT COULD GO WRONG. Define any technical term in the same sentence. Use 'you'."
    }
  ]
}

todays_edge_market: 0-3 risk flags total — only if genuinely time-sensitive. Empty arrays are fine.
radar_candidates: 8-10 high-conviction thematic stocks across AI / semis / nuclear / quantum / rare earths / biotech / crypto infra. The user's actual holdings will be filtered out later — don't try to filter here. Each entry MUST include deep_reasoning.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 4500, maxSearches: 2, label: "layerA-market" });
}

async function generateLayerASmartMoney(name: string, date: string): Promise<any> {
  return generateSmartMoneyOnly(name, date);
}

async function generateLayerA(name: string, watchlist: string[], date: string): Promise<any> {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const [marketResult, smResult] = await Promise.allSettled([
    generateLayerAMarket(name, tickers, date),
    generateLayerASmartMoney(name, date),
  ]);
  const layerA: any = { generatedAt: new Date().toISOString(), date };
  if (marketResult.status === "fulfilled" && marketResult.value) Object.assign(layerA, marketResult.value);
  if (smResult.status === "fulfilled" && smResult.value) Object.assign(layerA, smResult.value);
  return layerA;
}

// ─── Layer B (user-specific; no web search) ────────────────────────
async function generateUserAwareEdge(name: string, date: string, layerA: any, holdings: any[]): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const layerEdge = layerA?.todays_edge_market || {};
  const binaryCatalysts = Array.isArray(layerEdge.binary_catalysts) ? layerEdge.binary_catalysts : [];
  const riskFlags = Array.isArray(layerEdge.risk_flags) ? layerEdge.risk_flags : [];
  const earningsAlerts: any[] = [];
  for (const cat of binaryCatalysts) {
    const t = (cat?.ticker || "").toUpperCase();
    if (ownedSet.has(t)) {
      const holding = (holdings || []).find((h: any) => (h.symbol || "").toUpperCase() === t);
      earningsAlerts.push({ ticker: t, when: cat.event || "", your_shares: holding?.qty ?? 0 });
    }
  }
  return { todays_edge: { earnings_alerts: earningsAlerts, binary_catalysts: binaryCatalysts, risk_flags: riskFlags } };
}

async function generateRadarFromCandidates(layerA: any, holdings: any[]): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const candidates = Array.isArray(layerA?.radar_candidates) ? layerA.radar_candidates : [];
  const filtered = candidates.filter((c: any) => {
    const t = (c?.ticker || "").toUpperCase();
    return t && !ownedSet.has(t);
  });
  return { radar_watch: filtered.slice(0, 6) };
}

async function generateConvictionFromContext(
  name: string,
  date: string,
  layerA: any,
  watchlist: string[],
  holdings: any[]
): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0)
    ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol)
    : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0 ? `\nFor conviction_watch, focus on: ${focusTickers.join(", ")}.` : "";
  const contextSlice = {
    market_pulse: layerA?.market_pulse || null,
    smart_money_summary: layerA?.smart_money?.summary || null,
    sector_heatmap: layerA?.smart_money?.sector_heatmap || null,
  };

  const prompt = `${COMMON_PREAMBLE(name, date)}
You have already-fetched market context below. DO NOT search — use this context directly.

MARKET CONTEXT (today, fetched at ${layerA?.generatedAt || date}):
${JSON.stringify(contextSlice, null, 2)}
${ownedNote}${tickerNote}

Return ONLY this JSON:

{
  "conviction_watch": [
    {
      "ticker": "TICKER",
      "signal": "add or hold or trim",
      "why_now": "1-2 short sentences, max 25 words",
      "note": "tight summary, max 8 words",
      "action": "OPTIONAL concrete trade with size, max 12 words — omit for routine holds",
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Cover: WHY this signal NOW, WHY YOU MIGHT WANT TO FOLLOW IT, WHAT TO THINK ABOUT FIRST (cost basis, position size, IRA vs taxable), WHAT COULD GO WRONG. Define any technical term in the same sentence. Use 'you' and 'your'. Full sentences."
    }
  ],
  "opportunity_watch": [
    {
      "ticker": "TICKER (must NOT be in user's holdings)",
      "theme": "short tag matching user's themes",
      "fits_gap": "1-line tagline, max 14 words",
      "headline": "1-line catalyst, max 14 words",
      "deep_reasoning": "180-220 word personalized buy thesis. Cover (1) WHY THIS FITS YOUR PORTFOLIO; (2) THE THESIS; (3) SIZING THINKING; (4) WHAT COULD GO WRONG. Define any technical term in the same sentence. Use 'you'."
    }
  ]
}

CRITICAL: No web_search. Reason from the context. Omit rather than fabricate.
conviction_watch: 8-10 entries. Mix add/hold/trim. EVERY entry MUST include deep_reasoning.
opportunity_watch: 6-8 ideas NOT in user's holdings. Match themes.
NEVER use placeholders like "DATA_UNAVAILABLE", "N/A", "NONE". Empty arrays are fine.`;

  return callJsonChunk(prompt, { search: false, maxTokens: 7000, model: "claude-haiku-4-5", label: "conviction" });
}

async function generateLayerB(opts: {
  name: string;
  watchlist: string[];
  holdings: any[];
  accounts: any[] | undefined;
  holdingsAgeDays: number | null;
  date: string;
  layerA: any;
}): Promise<any> {
  const { name, watchlist, holdings, accounts, holdingsAgeDays, date, layerA } = opts;
  const tasks = [
    generateLightChunk(name, holdings, accounts, holdingsAgeDays, date),
    generateConvictionFromContext(name, date, layerA, watchlist, holdings),
    generateUserAwareEdge(name, date, layerA, holdings),
    generateRadarFromCandidates(layerA, holdings),
  ];
  const results = await Promise.allSettled(tasks);
  const merged: any = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) Object.assign(merged, r.value);
    else if (r.status === "rejected") console.warn("Layer B chunk failed:", r.reason?.message || r.reason);
  }
  if (layerA?.market_pulse) merged.market_pulse = layerA.market_pulse;
  if (layerA?.smart_money) merged.smart_money = layerA.smart_money;
  return merged;
}

// ─── Legacy chunks (used for cold-path Tier 3) ─────────────────────
async function generateLightChunk(
  name: string,
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null,
  date: string
) {
  const holdingsBlock = formatHoldingsBlock(holdings, accounts, holdingsAgeDays);
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount
    ? `\nMULTI-ACCOUNT REQUIREMENT: User has positions in ${accounts!.length} accounts. EVERY decision MUST name the specific account (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh").`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}

Return ONLY this JSON shape with all fields populated:

{
  "affirmation": "short sharp opening line, max 12 words",
  "mindset": {
    "gratitude": "stimulating affirmation in Stoic warrior / Quiet power / Athlete mindset voice, max 18 words. Vary by day.",
    "fuel": {
      "headline": "Short summary of the routine in one phrase, max 14 words",
      "total_min": 10,
      "blocks": [
        { "name": "Mobility (2 min)", "moves": ["3-4 specific movements with reps"], "why": "1 sentence (max 18 words)" },
        { "name": "Breathwork (3 min)", "moves": ["2-3 breath patterns with timing"], "why": "1 sentence" },
        { "name": "Strength (3 min)", "moves": ["3-4 bodyweight movements with reps"], "why": "1 sentence" },
        { "name": "Cooldown (2 min)", "moves": ["2-3 stretches with hold duration"], "why": "1 sentence" }
      ],
      "tip": "1-2 sentence pro tip"
    },
    "focus": "concrete breath/mental cue, max 10 words"
  },
  "clarity": {
    "contemplation": "ONE present-tense sentence to sit with for 60 seconds, max 22 words",
    "eastern_wisdom": { "quote": "real attributed quote", "source": "attribution" },
    "breath_practice": { "name": "breath name", "pattern": "timing", "description": "physiological effect, max 24 words", "rounds": "rounds or duration" }
  },
  "power_plate": {
    "name": "recipe name, max 6 words",
    "style": "High Protein or Mediterranean or Anti-Inflammatory",
    "protein_g": 30,
    "prep_min": 25,
    "description": "4-5 sentences (110-150 words) inviting like a chef would",
    "why_this_meal": "120-170 word plain-English: macros, anti-inflammatory angles, mood tie, long-term benefit",
    "groceries": ["7-10 line items with rough quantities AND brief tag"],
    "prep_steps": ["7-9 cooking steps, 25-40 words each, with timing and sensory tells"],
    "swap_options": ["3-4 simple substitutions"],
    "pairing": "2-3 sentences on what to drink or serve alongside"
  },
  "decisions": [
    "8-10 PERSONALIZED trade actions/observations referencing the user's actual holdings + today's catalysts. TARGET 10."
  ],
  "decisions_reasoning": [
    "For EACH decision (same order), 130-180 word plain-English explanation defining any technical term."
  ]
}
${accountRule}

CRITICAL: holdings 'cost' is PER-SHARE average cost basis, NOT total dollars. To get total dollar basis, multiply cost × qty.

PLAIN ENGLISH IN THE SHORT DECISION FIELD — write so a non-trader understands at a glance:
- Use "shares" not "sh" or "SH" (e.g. "Sell 350 shares" not "Sell 350SH").
- Use "$" + dollar gain alongside percentage when the cost basis is known (e.g. "SIDU is up $980 (+12.3%) on 700 shares" — not "SIDU +12.3% on 700SH").
- Spell out times explicitly: "at market open (9:30 AM ET)" not just "Market Open."
- BAN these trader-slang phrases in the short decision text: "house money", "lock 50%", "ride the rest", "scale out", "let it run", "size up", "size down", "trim into strength", "fade", "chase", "leg in", "swing", "tape." Use plain replacements:
  * "house money" → "the rest is pure profit — anything from here is bonus"
  * "lock 50% gain" → "take half your profit off the table"
  * "scale out" → "sell in pieces"
  * "trim into strength" → "sell some while the price is high"
- The short decision must still be ONE concrete trade (not multiple steps), under ~25 words, but in language an investor who's NOT a day-trader can read in 3 seconds and understand.

GOOD short-decision example (plain English):
  "SIDU is up $980 (+12.3%) on 700 shares — sell 350 shares at market open (9:30 AM ET) to take half your profit off the table. The remaining 350 shares are pure profit from here."
BAD short-decision example (jargon — rejected):
  "SIDU +12.3% on 700SH — Lock 50% gain. Sell 350SH at Market Open; House money from here."

GOOD decision example (plain English): "IONQ is up +45% on your 175 shares — earnings drop May 6. Sell 75 shares Friday to take some profit before the report."
BAD example to avoid: "Review highest-conviction position" — too generic.

ABSOLUTE BAN ON CONDITIONALS AND HOMEWORK — applies to BOTH decisions AND decisions_reasoning:
- Every decision must be a SINGLE concrete trade. ZERO conditionals. ZERO homework. The user pays this app TO DO the research — never tell them to do it.
- ANY decision OR reasoning string containing the words "check if", "verify", "reassess", "wait for", "depending on", "see if", "if silent", "if any", "if execs sold", "if they", or any phrase like "if X then do A else do B" is INVALID and must be rewritten as a single direct stance.
- If you don't have data to decide cleanly: OMIT the position from decisions entirely. Do NOT generate a hedged or conditional entry. Cutting a decision is better than offloading work onto the user.
- The decisions_reasoning paragraph is ALSO subject to this rule — no "what to consider" lists that secretly ask the user to do research. The reasoning explains WHY you took the stance you took; it does NOT enumerate things the user should check.

REAL BAD EXAMPLE (rejected — exact pattern recently seen in production):
  decision: "QCOM -6.1% drawdown is capitulation signal in otherwise bullish sector. Check if any Form 4s filed by insiders in last 48 hours. If silent, add 10 shares at market open; if execs sold, reduce to 15 shares and reassess China exposure thesis."
  → THREE rule violations: (1) tells user to "check Form 4s" (homework), (2) conditional logic ("if silent... if execs sold..."), (3) "reassess thesis" (more homework). This is a generic equivocation, not a decision.

REAL GOOD EXAMPLE (acceptable rewrite of same setup):
  decision: "QCOM -6.1% to $200.08 — ADD 10 sh at open. Drawdown is capitulation into bullish semis tape; China iPhone modem concern is priced in at this level."
  → Single concrete action, single price, single stance. No conditionals. No homework. The user reads it and acts.

CRITICAL TICKER ACCURACY: Never guess company names. SMMT is Summit Therapeutics. CIFR is Cipher Mining. APLD is Applied Digital. USAR is USA Rare Earth. SMR is NuScale. IREN is Iris Energy. When in doubt, use ticker only.`;

  return callJsonChunk(prompt, { maxTokens: 5000, model: "claude-haiku-4-5", label: "light" });
}

async function generatePulseAndEdge(name: string, watchlist: string[], holdings: any[], date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const radarExclusion = ownedSet.size > 0 ? `\nFor radar_watch: EXCLUDE any tickers the user already owns.` : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, macro events, and any earnings/FDA/catalysts in the next 1-2 weeks. Watchlist: ${tickers}.${ownedNote}${radarExclusion}

Return ONLY this JSON:

{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each"]
  },
  "todays_edge": {
    "earnings_alerts": [ { "ticker": "TICKER", "when": "today after close", "your_shares": 0 } ],
    "binary_catalysts": [ { "ticker": "TICKER", "event": "event date", "context": "max 12 words" } ],
    "risk_flags": [ { "ticker": "TICKER", "flag": "max 12 words", "suggested_action": "max 12 words" } ]
  },
  "radar_watch": [
    { "ticker": "TICKER", "theme": "tag", "headline": "max 14 words", "why_now": "max 18 words", "deep_reasoning": "130-180 word plain-English explanation for someone new to trading. Define any technical term. Use 'you'." }
  ]
}

todays_edge: 0-3 alerts. Empty arrays fine.
radar_watch: 4-6 high-conviction thematic stocks the user does NOT own.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 2800, maxSearches: 2, label: "pulse" });
}

async function generateSmartMoneyOnly(name: string, date: string) {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch the LATEST 13F disclosures, biggest insider Form 4 trades from the past 1-2 weeks, and most recent congressional STOCK Act filings.

Return ONLY this JSON:

{
  "smart_money": {
    "summary": {
      "most_bought": ["TICKER1", "TICKER2"],
      "most_sold": ["TICKER1", "TICKER2"],
      "net_bullish_sectors": ["2-3 sector names"],
      "net_bearish_sectors": ["1-2 sector names"]
    },
    "sector_heatmap": [{ "sector": "name max 22 chars", "direction": "buying|selling|neutral", "intensity": 1 }],
    "whale_moves": [{ "text": "named trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation." }],
    "congress_moves": [{ "text": "named congressional trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation." }],
    "hedge_fund_moves": [{ "text": "named hedge fund trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation." }]
  }
}

CRITICAL DATA RULES:
- NEVER use placeholder strings.
- whale_moves/congress_moves/hedge_fund_moves: 3-5 entries each. Every entry MUST be a SPECIFIC TRADE by a NAMED person/fund with a real ticker. Empty arrays are fine if no real trades found.
- BAD: news commentary, calendar notes, vague exposure summaries, political headlines, generic crowd statements.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 5000, maxSearches: 2, label: "smart-money" });
}

async function generateConvictionAndOpportunity(name: string, watchlist: string[], holdings: any[], date: string) {
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0)
    ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol)
    : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0 ? `\nFor conviction_watch, focus on: ${focusTickers.join(", ")}.` : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times to fetch the current technical setup, recent catalysts, and thematic news.${ownedNote}${tickerNote}

Return ONLY this JSON:

{
  "conviction_watch": [
    { "ticker": "TICKER", "signal": "add or hold or trim", "why_now": "max 25 words", "note": "max 8 words", "action": "OPTIONAL trade max 12 words", "deep_reasoning": "130-180 word plain-English explanation for someone NEW to trading. Define any technical term. Use 'you'." }
  ],
  "opportunity_watch": [
    { "ticker": "TICKER (NOT in user's holdings)", "theme": "tag", "fits_gap": "max 14 words", "headline": "max 14 words", "deep_reasoning": "180-220 word personalized buy thesis." }
  ]
}

conviction_watch: 8-10 entries. Mix add/hold/trim. EVERY entry needs deep_reasoning.
opportunity_watch: 6-8 ideas NOT in user's holdings.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 8000, maxSearches: 2, label: "conv-opp" });
}

// ─── Helpers ──────────────────────────────────────────────────────
// CRITICAL: 'cost' in holdings is the per-share average cost basis from
// the Fidelity CSV. We label this explicitly so the LLM never reads
// "$5.99 cost" as a total dollar value on a 175-share position.
function formatHoldingsBlock(
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null
) {
  if (!holdings || holdings.length === 0) return "";
  const accountLabel: Record<string, string> = {};
  if (Array.isArray(accounts)) {
    for (const a of accounts) {
      if (a && a.id) accountLabel[a.id] = a.name || "Account";
    }
  }
  const groups: Record<string, any[]> = {};
  for (const h of holdings) {
    const key = h.accountId || "_unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(h);
  }
  const formatHolding = (h: any) => {
    const parts = [`${h.symbol}`];
    if (h.qty != null) parts.push(`${h.qty} sh`);
    if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)}/share avg cost`); if (h.cost != null && h.qty != null && h.value != null) { const tg = h.value - (h.cost * h.qty); parts.push((tg >= 0 ? "+" : "-") + "$" + Math.abs(tg).toFixed(0) + " total gain"); }
    if (h.gainPct != null) {
      const sign = h.gainPct >= 0 ? "+" : "";
      parts.push(`${sign}${h.gainPct.toFixed(1)}% total return`);
    }
    return "    • " + parts.join(", ");
  };
  const groupBlocks: string[] = [];
  for (const [accountId, list] of Object.entries(groups)) {
    const label = accountId === "_unknown" ? "Unlabeled holdings" : (accountLabel[accountId] || "Account");
    groupBlocks.push(`  Account: ${label}\n${list.map(formatHolding).join("\n")}`);
  }
  const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7
    ? ` (${holdingsAgeDays} days old)` : "";
  return `\n\nUSER'S HOLDINGS${ageNote} — costs are PER-SHARE averages, NOT totals:\n${groupBlocks.join("\n\n")}\n`;
}

function buildCacheKey(input: { name: string; watchlist: string[]; holdings: any[]; date: string }) {
  const holdingsFingerprint = (input.holdings || [])
    .map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`)
    .sort()
    .join(",");
  const watchFingerprint = (input.watchlist || []).slice().sort().join(",");
  const raw = JSON.stringify({
    n: input.name || "",
    w: watchFingerprint,
    h: holdingsFingerprint,
    d: input.date || "",
  });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ─── Main handler ─────────────────────────────────────────────────
export async function POST(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  try {
    // Rate limit
    const rateCheck = await checkRateLimit(request);
    if (!rateCheck.ok) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait an hour." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
      );
    }

    const url = new URL(request.url);
    const queryFresh = url.searchParams.get("fresh") === "1";
    const wantsStream = url.searchParams.get("stream") === "1";
    const rawBody = await request.json().catch(() => null);

    const validation = validateBody(rawBody);
    if (!validation.ok) {
      const failed = validation as { ok: false; error: string };
      return NextResponse.json({ error: failed.error }, { status: 400 });
    }
    const validBody = (validation as { ok: true; body: ValidatedRequestBody }).body;
    const { name, watchlist, holdings, accounts, holdingsAgeDays, date, forceFresh } = validBody;
    const fresh = queryFresh || forceFresh;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY" },
        { status: 500 }
      );
    }

    // Save user state for cron job to pick up tomorrow (fire-and-forget)
    cacheWriteUserState(validBody).catch(() => {});

    const dateKey = todayDateString();
    const hHash = holdingsHash(holdings);

    console.log(
      `[brief ${requestId}] start fresh=${fresh} stream=${wantsStream} holdings=${holdings.length} watchlist=${watchlist.length} hash=${hHash}`
    );

    // ── Tier 1: full-brief cache ──
    if (!fresh) {
      const cachedFull = await cacheReadFullBrief(dateKey, hHash);
      if (cachedFull) {
        const elapsed = Date.now() - startTime;
        console.log(`[brief ${requestId}] tier1 hit elapsed=${elapsed}ms`);
        if (wantsStream) return streamCachedBrief(cachedFull, requestId);
        return NextResponse.json({
          brief: cachedFull,
          cached: true,
          tier: 1,
          _meta: { requestId, elapsedMs: elapsed },
        });
      }
    }

    // ── Tier 2: Layer A cached → fast Layer B regen ──
    if (!fresh) {
      const layerA = await cacheReadLayerA(dateKey);
      if (layerA) {
        try {
          const merged = await generateLayerB({
            name, watchlist, holdings, accounts, holdingsAgeDays, date, layerA,
          });
          if (merged && Object.keys(merged).length > 0) {
            await cacheWriteFullBrief(dateKey, hHash, merged);
            const elapsed = Date.now() - startTime;
            console.log(`[brief ${requestId}] tier2 ok elapsed=${elapsed}ms`);
            if (wantsStream) return streamCachedBrief(merged, requestId);
            return NextResponse.json({
              brief: merged,
              cached: false,
              tier: 2,
              _meta: { requestId, elapsedMs: elapsed },
            });
          }
        } catch (err) {
          console.warn(`[brief ${requestId}] tier2 layer-B failed, falling to tier3:`, err);
        }
      }
    }

    // ── Tier 3: Full legacy generation ──
    if (wantsStream) {
      const cacheKey = buildCacheKey({ name, watchlist, holdings, date });
      return streamFreshBrief({
        name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey, requestId,
      });
    }

    const tasks = [
      generateLightChunk(name, holdings, accounts, holdingsAgeDays, date),
      generatePulseAndEdge(name, watchlist, holdings, date),
      generateSmartMoneyOnly(name, date),
      generateConvictionAndOpportunity(name, watchlist, holdings, date),
    ];

    const results = await Promise.allSettled(tasks);
    const merged: any = {};
    const failures: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) Object.assign(merged, r.value);
      else if (r.status === "rejected") failures.push(r.reason?.message || "unknown");
    }

    if (Object.keys(merged).length === 0) {
      return NextResponse.json(
        { error: `All chunks failed: ${failures.join("; ")}` },
        { status: 502 }
      );
    }

    const cacheKey = buildCacheKey({ name, watchlist, holdings, date });
    await cacheWriteBrief(cacheKey, merged);
    await cacheWriteFullBrief(dateKey, hHash, merged);

    const synthLayerA = extractLayerAFromBrief(merged);
    if (synthLayerA) await cacheWriteLayerA(dateKey, synthLayerA);

    const elapsed = Date.now() - startTime;
    console.log(`[brief ${requestId}] tier3 ok elapsed=${elapsed}ms failures=${failures.length}`);

    return NextResponse.json({
      brief: merged,
      cached: false,
      tier: 3,
      _meta: { requestId, elapsedMs: elapsed },
      partial: failures.length > 0 ? { failedChunks: failures.length } : undefined,
    });
  } catch (err: any) {
    console.error(`[brief ${requestId}] failed:`, err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Unknown server error", _meta: { requestId } },
      { status: 500 }
    );
  }
}

// ─── SSE streaming ─────────────────────────────────────────────────
function sseEncode(eventName: string, data: any): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamCachedBrief(brief: any, requestId: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(sseEncode("chunk", { chunkName: "cached", fields: brief })));
      controller.enqueue(encoder.encode(sseEncode("complete", { brief, cached: true, _meta: { requestId } })));
      controller.enqueue(encoder.encode(sseEncode("done", {})));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function streamFreshBrief(opts: {
  name: string;
  watchlist: string[];
  holdings: any[];
  accounts: any[];
  holdingsAgeDays: number | null;
  date: string;
  cacheKey: string;
  requestId: string;
}): Response {
  const { name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey, requestId } = opts;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (eventName: string, data: any) => {
        controller.enqueue(encoder.encode(sseEncode(eventName, data)));
      };

      send("chunk", { chunkName: "started", fields: {} });

      const merged: any = {};
      const failures: string[] = [];

      const tasks = [
        { name: "light", promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date) },
        { name: "pulse", promise: generatePulseAndEdge(name, watchlist, holdings, date) },
        { name: "smart_money", promise: generateSmartMoneyOnly(name, date) },
        { name: "conviction", promise: generateConvictionAndOpportunity(name, watchlist, holdings, date) },
      ];

      const wired = tasks.map((t) =>
        t.promise.then(
          (val) => {
            if (val && typeof val === "object") {
              Object.assign(merged, val);
              send("chunk", { chunkName: t.name, fields: val });
            }
          },
          (err) => {
            failures.push(`${t.name}: ${err?.message || "unknown"}`);
            send("error", { chunkName: t.name, message: err?.message || "Chunk failed" });
          }
        )
      );

      await Promise.all(wired);

      if (Object.keys(merged).length === 0) {
        send("error", { fatal: true, message: `All chunks failed: ${failures.join("; ")}` });
      } else {
        await cacheWriteBrief(cacheKey, merged);
        const dateKey = todayDateString();
        const hHash = holdingsHash(holdings);
        await cacheWriteFullBrief(dateKey, hHash, merged);
        const synthLayerA = extractLayerAFromBrief(merged);
        if (synthLayerA) await cacheWriteLayerA(dateKey, synthLayerA);

        console.log(`[brief ${requestId}] stream done failures=${failures.length}`);
        send("complete", {
          brief: merged,
          cached: false,
          _meta: { requestId },
          partial: failures.length > 0 ? { failedChunks: failures.length } : undefined,
        });
      }

      send("done", {});
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
