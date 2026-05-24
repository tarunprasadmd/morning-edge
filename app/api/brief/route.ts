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

UNIVERSAL ACTION VERB POLICY — applies to EVERY string field in EVERY section (smart_money, decisions, conviction_watch, opportunity_watch, radar_watch, reasoning, action, why_now, why_matters, headline, fits_gap, etc.):

ALLOWED ACTION VERBS (use only these, capitalized when they lead an entry):
  BOUGHT  — established a new position OR added significantly
  SOLD    — closed a position OR reduced significantly
  ADDED   — incremental add to existing position
  EXITED  — full position close
  HELD    — kept the position unchanged
  AVOID   — recommendation to not buy

BANNED VERBS (do NOT use any of these — they are vague, jargon, or filler):
  initiated, boosted, raised, trimmed, cut, stake (as a verb), put (as a verb),
  scaled, swung, faded, chased, legged-in, sized-up, sized-down, took-profit (as compound),
  established (use BOUGHT), opened (use BOUGHT), closed (use SOLD or EXITED),
  reduced (use SOLD or EXITED), unloaded, dumped, accumulated (use BOUGHT).

ALWAYS include a SPECIFIC number with the verb: share count ("2.1M shares") OR dollar amount ("$48M") OR percent of position ("40% of position"). Vague terms like "a big stake," "a major position," "significant exposure" without numbers are BANNED.

WHY THIS MATTERS: the user reads dozens of these per day. Consistent vocabulary across the entire app (smart-money cards, decisions, conviction, opportunity, radar, chat answers) makes scanning fast. Mixed verbs make every line require re-reading.

PLAIN-ENGLISH SHORT-DECISION RULES (additional, for the decisions array specifically):
- Use "shares" not "sh" or "SH" (e.g. "Sell 350 shares" not "Sell 350SH").
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
    "key_levels": [
      {
        "text": "Short bullet, max 14 words — WHAT + DIRECTION + MAGNITUDE + CONTEXT (e.g. 'S&P futures +0.4% before open, watching CPI Wed', 'VIX at 14.2, 1-month low', 'Brent crude $78, OPEC+ meeting Thursday', 'Semis leading: SMH +1.1% premarket')",
        "deep_context": "60-90 word plain-English explanation of WHY this specific bullet matters today. Reference the specific number from text. Tell the reader what to watch for and what action could make sense. Don't repeat the bullet — go DEEPER. Define any technical term in the same sentence. Use 'you'."
      }
    ]
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

key_levels: 6-8 bullets. EACH bullet MUST be an object with both 'text' AND 'deep_context' fields. Vague bullets like "Tech sector strong" or "Watching the Fed" are BANNED — every bullet cites a specific number. Every bullet must pass: "Can a trader act on this?"
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
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
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

  // PARALLEL DISPATCH (5/24/26 perf fix): instead of one big call generating
  // 8-10 conviction + 6-8 opportunity entries (~3000 tokens, 30-40 sec on Haiku),
  // run two parallel calls — one for conviction only, one for opportunity only.
  // Each generates ~1500 tokens = ~12-15 sec on Haiku. Total wall-clock: ~15 sec
  // instead of 35. Same total content, half the time.

  const convictionPrompt = `${COMMON_PREAMBLE(name, date)}
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
  ]
}

CRITICAL: No web_search. Reason from the context. Omit rather than fabricate.
conviction_watch: 8-10 entries. Mix add/hold/trim. EVERY entry MUST include deep_reasoning.
NEVER use placeholders like "DATA_UNAVAILABLE", "N/A", "NONE". Empty arrays are fine.`;

  const opportunityPrompt = `${COMMON_PREAMBLE(name, date)}
You have already-fetched market context below. DO NOT search — use this context directly.

MARKET CONTEXT (today, fetched at ${layerA?.generatedAt || date}):
${JSON.stringify(contextSlice, null, 2)}
${ownedNote}

Return ONLY this JSON:

{
  "opportunity_watch": [
    {
      "ticker": "TICKER (must NOT be in user's holdings)",
      "theme": "short sector or theme tag - does NOT need to match user themes",
      "fits_gap": "1-line tagline, max 14 words",
      "headline": "1-line catalyst, max 14 words",
      "deep_reasoning": "180-220 word personalized buy thesis. Cover (1) WHY THIS FITS YOUR PORTFOLIO; (2) THE THESIS; (3) SIZING THINKING; (4) WHAT COULD GO WRONG. Define any technical term in the same sentence. Use 'you'."
    }
  ]
}

CRITICAL: No web_search. Reason from the context. Omit rather than fabricate.
opportunity_watch: 6-8 ideas. ABSOLUTELY EXCLUDE all tickers in user's holdings - cross-check every symbol against the holdings list before including. Pick from a MIX of sectors including ones user does NOT own - consider financials, healthcare/biotech, consumer staples, energy, industrials, REITs, materials, communications, not just AI/semis/nuclear. AT MOST 2 of 6-8 picks may be in user's existing themes; the rest MUST be in sectors user does not currently hold. CRITICAL: NEVER fabricate company descriptions. If you are not certain what a ticker's actual business is, OMIT IT.
NEVER use placeholders like "DATA_UNAVAILABLE", "N/A", "NONE". Empty arrays are fine.`;

  // Dispatch in parallel
  const [convResult, oppResult] = await Promise.allSettled([
    callJsonChunk(convictionPrompt, { search: false, maxTokens: 4500, model: "claude-haiku-4-5", label: "conviction-only" }),
    callJsonChunk(opportunityPrompt, { search: false, maxTokens: 4500, model: "claude-haiku-4-5", label: "opportunity-only" }),
  ]);

  const merged: any = {};
  if (convResult.status === "fulfilled" && convResult.value?.conviction_watch) {
    merged.conviction_watch = convResult.value.conviction_watch;
  }
  if (oppResult.status === "fulfilled" && oppResult.value?.opportunity_watch) {
    merged.opportunity_watch = oppResult.value.opportunity_watch.filter(
      (o: any) => !ownedSet.has((o.symbol || o.ticker || "").toUpperCase())
    );
  }
  return merged;
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
  if (layerA?.smart_money) merged.smart_money = layerA.smart_money; if (Array.isArray(merged.opportunity_watch) && Array.isArray(merged.radar_watch)) { const oppTickers = new Set(merged.opportunity_watch.map((o: any) => (o.symbol || o.ticker || "").toUpperCase())); merged.radar_watch = merged.radar_watch.filter((r: any) => !oppTickers.has((r.symbol || r.ticker || "").toUpperCase())); }
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

  // ─── Power Plate diversity rotation ──────────────────────────────
  // Seeded by day-of-year so the same date always picks the same meal
  // (idempotent for cache). 15 proteins × 15 cuisines = salmon appears
  // at most 1 in every 15 days. Fixes the "salmon every day" feedback.
  const dayOfYear = (() => {
    try {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return 0;
      const start = new Date(d.getFullYear(), 0, 0);
      return Math.floor((d.getTime() - start.getTime()) / 86400000);
    } catch { return 0; }
  })();
  const PROTEIN_ROTATION = [
    "chicken thigh", "cod or branzino", "lentils", "lamb", "turkey breast",
    "rainbow trout", "shrimp", "extra-firm tofu", "ground bison or lean beef",
    "bay scallops", "chickpeas with halloumi", "duck breast", "albacore tuna",
    "salmon", "eggs with feta and greens",
  ];
  const CUISINE_ROTATION = [
    "Mediterranean", "Japanese", "Indian", "Mexican", "Thai",
    "Italian", "Greek", "Korean", "Middle Eastern", "Vietnamese",
    "French Provençal", "Moroccan", "Chinese-inspired", "California fresh", "Peruvian",
  ];
  const todayProtein = PROTEIN_ROTATION[dayOfYear % PROTEIN_ROTATION.length];
  const todayCuisine = CUISINE_ROTATION[(dayOfYear + 3) % CUISINE_ROTATION.length];
  const powerPlateRule = `\nPOWER PLATE STRICT ROTATION (NON-NEGOTIABLE):\n- Today's protein MUST be: ${todayProtein}\n- Today's cuisine MUST be: ${todayCuisine}\n- DO NOT substitute. DO NOT default to salmon unless today's protein IS salmon.\n- Build the recipe name, description, groceries, and prep_steps entirely around this protein + cuisine pairing.\n- Style field should reflect the cuisine (e.g., "Mediterranean" / "Japanese" / "Indian" / "Mexican") — not always "High Protein".`;

  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}${powerPlateRule}

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

CRITICAL TICKER ACCURACY: Never guess company names. SMMT is Summit Therapeutics. CIFR is Cipher Mining. APLD is Applied Digital. USAR is USA Rare Earth. SMR is NuScale. IREN is Iris Energy. When in doubt, use ticker only.

NON-NEGOTIABLE FIELD COMPLETENESS — every one of these MUST be a populated string (not empty, not null):
- affirmation
- mindset.gratitude
- mindset.focus
- clarity.contemplation
- clarity.eastern_wisdom.quote (real, attributable — not invented)
- clarity.eastern_wisdom.source
- clarity.breath_practice.name and .pattern
The UI renders each as its own row; an empty field shows as a blank/missing row to the user. Treat these as required fields, not optional placeholders. If you're unsure of a real wisdom quote, pick a well-known one (Marcus Aurelius, Lao Tzu, Rumi, Epictetus, Thich Nhat Hanh, Seneca) rather than invent.

PARITY RULE — decisions and decisions_reasoning arrays MUST have IDENTICAL lengths. Every decision MUST have a matching reasoning at the same index. Never return 8 decisions with 7 reasonings or vice versa.`;

  const result = await callJsonChunk(prompt, { maxTokens: 5000, model: "claude-haiku-4-5", label: "light" });

  // Post-validate decisions ↔ decisions_reasoning length parity. If the AI
  // returned mismatched counts (Haiku occasionally drops the last reasoning),
  // pad with explanatory placeholder so the UI's index lookup never goes blank.
  if (result && Array.isArray(result.decisions)) {
    if (!Array.isArray(result.decisions_reasoning)) {
      result.decisions_reasoning = [];
    }
    const decCount = result.decisions.length;
    const reasCount = result.decisions_reasoning.length;
    if (reasCount < decCount) {
      for (let i = reasCount; i < decCount; i++) {
        result.decisions_reasoning.push(
          "Full reasoning unavailable for this decision. The short call above stands — tap any other row for context, or refresh the brief to regenerate."
        );
      }
    } else if (reasCount > decCount) {
      result.decisions_reasoning = result.decisions_reasoning.slice(0, decCount);
    }
  }
  return result;
}

async function generatePulseAndEdge(name: string, watchlist: string[], holdings: any[], date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const radarExclusion = ownedSet.size > 0 ? `\nFor radar_watch: EXCLUDE any tickers the user already owns.` : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, macro events, and any earnings/FDA/catalysts in the next 1-2 weeks. Watchlist: ${tickers}.${ownedNote}${radarExclusion}

Return ONLY this JSON:

{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": [
      {
        "text": "max 14 words — WHAT + DIRECTION + MAGNITUDE + CONTEXT (e.g. 'S&P futures +0.4% before open', 'VIX at 14.2, 1-month low', 'Brent crude $78, OPEC+ Thursday')",
        "deep_context": "60-90 word plain-English explanation of WHY this bullet matters today. Reference the number. Tell reader what to watch and what action could make sense. Define any term in the same sentence. Use 'you'."
      }
    ]
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
radar_watch: 4-6 high-conviction thematic stocks the user does NOT own.

MARKET PULSE QUALITY BAR — STRICT:
- Each key_levels bullet must include: WHAT (index/sector/commodity/yield), DIRECTION (up/down/holding), MAGNITUDE (number — % or absolute level), and CONTEXT (why it matters today — earnings, FOMC, OPEC, CPI, etc.)
- BANNED: vague bullets like "Tech sector strong" or "Market is mixed" or "Watching the Fed". Always cite the specific data point.
- Each bullet should pass the test: "Can a trader act on this?"`;

  return callJsonChunk(prompt, { search: true, maxTokens: 2800, maxSearches: 2, label: "pulse" });
}

// ─── SMART MONEY URL POST-PROCESSOR ────────────────────────────────
// The AI generates source_urls from web_search results, which usually return
// aggregator/landing pages (sec.gov homepage, capitoltrades.com homepage,
// whalewisdom.com search). Prompt rules can't fully prevent this — we have
// to intercept and rewrite at server side.
//
// Strategy: parse the entity name from the leading words of `text` (before
// the first BOUGHT/SOLD/etc verb), look up in known-filer maps, and rewrite
// source_url to point to that entity's specific SEC EDGAR filings list or
// CapitolTrades politician page. These are SPECIFIC pages — not homepages —
// so the user can actually verify the trade.

const SEC_EDGAR_CIKS: Record<string, string> = {
  // Berkshire / Buffett
  "berkshire hathaway": "0001067983",
  "berkshire": "0001067983",
  "buffett": "0001067983",
  "warren buffett": "0001067983",
  // Major hedge funds
  "viking global": "0001103804",
  "viking global investors": "0001103804",
  "renaissance technologies": "0001037389",
  "renaissance": "0001037389",
  "rentech": "0001037389",
  "tiger global": "0001167483",
  "tiger global management": "0001167483",
  "coatue": "0001135730",
  "coatue management": "0001135730",
  "bridgewater": "0001350694",
  "bridgewater associates": "0001350694",
  "citadel": "0001423053",
  "citadel advisors": "0001423053",
  "two sigma": "0001179392",
  "two sigma investments": "0001179392",
  "millennium": "0001273087",
  "millennium management": "0001273087",
  "point72": "0001603466",
  "point72 asset management": "0001603466",
  "steve cohen": "0001603466",
  "de shaw": "0001009207",
  "d.e. shaw": "0001009207",
  "aqr capital": "0001167557",
  "aqr": "0001167557",
  "soros": "0001029160",
  "soros fund management": "0001029160",
  "george soros": "0001029160",
  "lone pine": "0001061165",
  "lone pine capital": "0001061165",
  "pershing square": "0001336528",
  "pershing": "0001336528",
  "ackman": "0001336528",
  "bill ackman": "0001336528",
  "greenlight capital": "0001079114",
  "greenlight": "0001079114",
  "einhorn": "0001079114",
  "david einhorn": "0001079114",
  "ark invest": "0001697748",
  "ark": "0001697748",
  "ark investment management": "0001697748",
  "cathie wood": "0001697748",
  "duquesne": "0001536411",
  "duquesne family office": "0001536411",
  "druckenmiller": "0001536411",
  "stanley druckenmiller": "0001536411",
  "scion asset management": "0001649339",
  "scion": "0001649339",
  "michael burry": "0001649339",
  "burry": "0001649339",
  "third point": "0001040273",
  "loeb": "0001040273",
  "dan loeb": "0001040273",
  "appaloosa": "0001656456",
  "tepper": "0001656456",
  "david tepper": "0001656456",
  "elliott management": "0001048445",
  "elliott": "0001048445",
  "icahn": "0000921669",
  "carl icahn": "0000921669",
  "blackrock": "0001364742",
  "vanguard": "0000102909",
  "state street": "0000093751",
};

function edgar13FUrl(cik: string): string {
  // Direct link to that filer's most recent 13F-HR filings list. NOT homepage.
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR&dateb=&owner=include&count=40`;
}

function edgarForm4Url(cik: string): string {
  // Direct link to that filer's Form 4 (insider trade) filings list. NOT homepage.
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=40`;
}

function capitoltradesSearchUrl(rawName: string): string {
  // Strip prefix titles, search CapitolTrades by name. Goes to a filtered
  // search result page — specific to that politician — not the homepage.
  const cleanName = (rawName || "")
    .replace(/^(sen\.?|rep\.?|senator|representative)\s+/i, "")
    .trim();
  return `https://www.capitoltrades.com/politicians?search=${encodeURIComponent(cleanName)}`;
}

function isGenericUrl(url: string): boolean {
  if (!url || typeof url !== "string") return true;
  const lower = url.toLowerCase().replace(/\/+$/, "");
  // Homepages and search-landing pages (not specific to a filer or trade)
  if (/^https?:\/\/(www\.)?sec\.gov$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?sec\.gov\/edgar$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?sec\.gov\/edgar\/search$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?sec\.gov\/cgi-bin\/browse-edgar$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?capitoltrades\.com$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?capitoltrades\.com\/trades$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?capitoltrades\.com\/politicians$/.test(lower)) return true;
  if (/^https?:\/\/(www\.)?whalewisdom\.com$/.test(lower)) return true;
  if (/whalewisdom\.com\/search/.test(lower)) return true;
  if (/wikipedia\.org/.test(lower)) return true;
  if (/google\.com\/search/.test(lower)) return true;
  if (/finance\.yahoo\.com\/news/.test(lower)) return true;
  if (/news\.google/.test(lower)) return true;
  return false;
}

function extractEntityFromText(text: string): string {
  // Entries follow the schema "ENTITY VERB AMOUNT TICKER" (e.g.
  // "Viking Global BOUGHT 2.1M shares NVDA"). Pull everything up to the
  // first ALL-CAPS verb.
  if (!text || typeof text !== "string") return "";
  const verbMatch = text.match(/\b(BOUGHT|SOLD|ADDED|EXITED|HELD|TRIMMED|REDUCED|INITIATED|OPENED|CLOSED|BUYS?|SELLS?|ADDS?|EXITS?|HOLDS?)\b/);
  if (verbMatch && verbMatch.index !== undefined) {
    return text.slice(0, verbMatch.index).trim();
  }
  // Fallback: take the first 3 words
  return text.split(/\s+/).slice(0, 3).join(" ").trim();
}

function rewriteSmartMoneySourceUrls(sm: any): any {
  if (!sm || typeof sm !== "object") return sm;
  const rewriteEntry = (entry: any, kind: "13F" | "form4" | "congress"): any => {
    if (!entry || typeof entry !== "object") return entry;
    const url = entry.source_url || "";
    if (!isGenericUrl(url)) return entry; // already specific — keep it
    const entity = extractEntityFromText(entry.text || "");
    const entityLower = entity.toLowerCase();
    if (!entityLower) return entry;
    // Hedge funds / 13F filers: look up CIK
    const cik = SEC_EDGAR_CIKS[entityLower];
    if (cik) {
      entry.source_url = kind === "form4" ? edgarForm4Url(cik) : edgar13FUrl(cik);
      return entry;
    }
    // Try partial match: trim trailing words and retry
    const parts = entityLower.split(/\s+/);
    for (let i = parts.length; i > 0; i--) {
      const partial = parts.slice(0, i).join(" ");
      if (SEC_EDGAR_CIKS[partial]) {
        entry.source_url = kind === "form4" ? edgarForm4Url(SEC_EDGAR_CIKS[partial]) : edgar13FUrl(SEC_EDGAR_CIKS[partial]);
        return entry;
      }
    }
    // Congressional: use capitoltrades politician search
    if (kind === "congress") {
      entry.source_url = capitoltradesSearchUrl(entity);
      return entry;
    }
    // Unknown entity, unknown CIK: drop the URL field rather than ship a homepage
    // (the entry still renders, just without a "view filing" link)
    entry.source_url = "";
    return entry;
  };
  if (Array.isArray(sm.whale_moves)) sm.whale_moves = sm.whale_moves.map((e: any) => rewriteEntry(e, "13F"));
  if (Array.isArray(sm.hedge_fund_moves)) sm.hedge_fund_moves = sm.hedge_fund_moves.map((e: any) => rewriteEntry(e, "13F"));
  if (Array.isArray(sm.congress_moves)) sm.congress_moves = sm.congress_moves.map((e: any) => rewriteEntry(e, "congress"));
  return sm;
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
    "whale_moves": [{ "text": "PERSON/FUND VERB AMOUNT TICKER (plain English, max 12 words)", "ticker": "TICKER", "source_url": "DIRECT-FILING-URL", "why_matters": "60-90 word plain-English explanation, written like you're texting a friend." }],
    "congress_moves": [{ "text": "PERSON/FUND VERB AMOUNT TICKER (plain English, max 12 words)", "ticker": "TICKER", "source_url": "DIRECT-FILING-URL", "why_matters": "60-90 word plain-English explanation, written like you're texting a friend." }],
    "hedge_fund_moves": [{ "text": "PERSON/FUND VERB AMOUNT TICKER (plain English, max 12 words)", "ticker": "TICKER", "source_url": "DIRECT-FILING-URL", "why_matters": "60-90 word plain-English explanation, written like you're texting a friend." }]
  }
}

CRITICAL DATA RULES:
- NEVER use placeholder strings.
- whale_moves/congress_moves/hedge_fund_moves: 3-5 entries each. Every entry MUST be a SPECIFIC TRADE by a NAMED person/fund with a real ticker. Empty arrays are fine if no real trades found.
- BAD: news commentary, calendar notes, vague exposure summaries, political headlines, generic crowd statements.

SOURCE URL — DIRECT TO FILING ONLY (NON-NEGOTIABLE):
The source_url field MUST link to the SPECIFIC filing or disclosure document, NOT a generic landing page. The user clicks this to verify the trade actually happened. Generic pages fail this test.
- For 13F filings: link to the SEC EDGAR filing detail page for THAT specific 13F-HR. Format: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=13F-HR — or better, the direct filing index URL.
- For Form 4 insider trades: link to the SEC EDGAR Form 4 filing detail page (https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=4).
- For congressional STOCK Act trades: link to the SPECIFIC trade page on capitoltrades.com (e.g. https://www.capitoltrades.com/trades/{trade_id}) OR the original PDF filing on house.gov/senate.gov clerk site. NOT capitoltrades.com homepage.
- BANNED source URLs (these will fail user trust): sec.gov/edgar homepage, capitoltrades.com homepage, whalewisdom.com generic search, news aggregator URLs, wikipedia, generic broker pages.
- If you can't find a direct filing URL, OMIT the entire entry. Don't fall back to a generic page.

TEXT FIELD WORDING — PLAIN ENGLISH, NO JARGON:
- Lead with the person or fund name, then a plain verb, then the size, then the ticker.
- Use ONLY these verbs: BOUGHT, SOLD, ADDED, EXITED, HELD.
- BANNED jargon verbs: "initiated", "boosted", "raised", "trimmed", "cut", "stake", "position" (as a verb), "scaled", "swung", "established", "opened", "closed", "reduced", "unloaded".
- ALWAYS include a specific number: share count ("2.1M shares"), dollar amount ("$48M"), OR clear percentage ("40% of position").
- Format examples (FOLLOW THESE EXACTLY):
  - "Viking Global BOUGHT 2.1M shares NVDA"
  - "Druckenmiller SOLD 500K shares TSLA"
  - "Renaissance BOUGHT 1.8M shares PLTR"
  - "Coatue BOUGHT 900K shares IONQ"
  - "Tiger Global SOLD 40% of META"
  - "Rep Gottheimer BOUGHT $50K NVDA calls"
  - "Sen Tuberville SOLD $250K TSLA"
  - "Sen Tuberville SOLD $250K TSLA" — not "sold TSLA"
- Name the person or fund first, then the verb, then the size, then the ticker. Keep it scannable.`;

  const result = await callJsonChunk(prompt, { search: true, maxTokens: 5000, maxSearches: 2, label: "smart-money" });
  // Post-process: rewrite any generic source_urls (sec.gov homepage,
  // capitoltrades homepage, news aggregators) to point to that specific
  // entity's filings list, by parsing the entity name from the entry text.
  if (result && result.smart_money) {
    result.smart_money = rewriteSmartMoneySourceUrls(result.smart_money);
  }
  return result;
}

async function generateConvictionAndOpportunity(name: string, watchlist: string[], holdings: any[], date: string) {
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
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
opportunity_watch: 6-8 ideas. ABSOLUTELY EXCLUDE all tickers in user's holdings - cross-check every symbol against the holdings list before including. Pick from a MIX of sectors including ones user does NOT own - consider financials, healthcare/biotech, consumer staples, energy, industrials, REITs, materials, communications, not just AI/semis/nuclear. AT MOST 2 of 6-8 picks may be in user's existing themes; the rest MUST be in sectors user does not currently hold. CRITICAL: NEVER fabricate company descriptions. If you are not certain what a ticker's actual business is, OMIT IT. Returning 4 well-verified picks is far better than 8 with guessed descriptions.`;

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
        // Sanitize URLs on read: cached briefs may have been written with
        // older code that didn't post-process URLs. Apply rewrite at serve
        // time so users always see specific filing URLs, never homepages.
        if (cachedFull.smart_money) {
          cachedFull.smart_money = rewriteSmartMoneySourceUrls({ ...cachedFull.smart_money });
        }
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

    // ── Tier 2: Layer A cached → fast Layer B regen, STREAMED ──
    // (5/24/26: previously this awaited all Layer B chunks via generateLayerB
    // then streamed the result in one go — user waited 60 sec to see anything.
    // Now we dispatch each chunk individually and stream as they complete.
    // First useful content (Light chunk → Playbook decisions) arrives in
    // ~15-25 sec on Haiku, conviction streams in after.)
    if (!fresh) {
      const layerA = await cacheReadLayerA(dateKey);
      if (layerA) {
        if (wantsStream) {
          // Stream Tier 2 chunks as they complete (parallel dispatch)
          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              const send = (eventName: string, data: any) => {
                controller.enqueue(encoder.encode(sseEncode(eventName, data)));
              };

              send("chunk", { chunkName: "started", fields: {} });

              const accumulated: any = {};
              // Layer A passthrough — send immediately so market_pulse,
              // smart_money, todays_edge appear right away. No wait.
              const layerAFields: any = {};
              if (layerA?.market_pulse) layerAFields.market_pulse = layerA.market_pulse;
              if (layerA?.smart_money) {
                // Apply URL rewrite to cached smart_money so generic URLs from
                // the cron-generated cache also get cleaned at serve time.
                layerAFields.smart_money = rewriteSmartMoneySourceUrls({ ...layerA.smart_money });
              }
              if (Object.keys(layerAFields).length > 0) {
                Object.assign(accumulated, layerAFields);
                send("chunk", { chunkName: "layer-a", fields: layerAFields });
              }

              // Dispatch Layer B tasks in parallel, stream each as it completes
              const tasks = [
                {
                  name: "light",
                  promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date),
                },
                {
                  name: "conviction",
                  promise: generateConvictionFromContext(name, date, layerA, watchlist, holdings),
                },
                {
                  name: "edge",
                  promise: Promise.resolve(generateUserAwareEdge(name, date, layerA, holdings)),
                },
                {
                  name: "radar",
                  promise: Promise.resolve(generateRadarFromCandidates(layerA, holdings)),
                },
              ];

              const failures: string[] = [];
              const wired = tasks.map((t) =>
                t.promise.then(
                  (val) => {
                    if (val && typeof val === "object") {
                      Object.assign(accumulated, val);
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

              // De-dup radar against opportunity
              if (Array.isArray(accumulated.opportunity_watch) && Array.isArray(accumulated.radar_watch)) {
                const oppT = new Set(accumulated.opportunity_watch.map((o: any) => (o.symbol || o.ticker || "").toUpperCase()));
                accumulated.radar_watch = accumulated.radar_watch.filter((r: any) => !oppT.has((r.symbol || r.ticker || "").toUpperCase()));
              }

              // Cache the full result so the next load is Tier 1 (instant)
              if (Object.keys(accumulated).length > 0) {
                await cacheWriteFullBrief(dateKey, hHash, accumulated);
              }

              const elapsed = Date.now() - startTime;
              console.log(`[brief ${requestId}] tier2 stream done elapsed=${elapsed}ms failures=${failures.length}`);
              send("complete", { brief: accumulated, cached: false, tier: 2, _meta: { requestId, elapsedMs: elapsed } });
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
        // Non-streaming Tier 2 (legacy fallback)
        try {
          const merged = await generateLayerB({
            name, watchlist, holdings, accounts, holdingsAgeDays, date, layerA,
          });
          if (merged && Object.keys(merged).length > 0) {
            await cacheWriteFullBrief(dateKey, hHash, merged);
            const elapsed = Date.now() - startTime;
            console.log(`[brief ${requestId}] tier2 ok elapsed=${elapsed}ms`);
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
