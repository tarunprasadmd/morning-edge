// /api/cron/generate-brief
//
// Runs daily at 5 AM ET (= 9 UTC, configured in vercel.json).
// Reads the most recent user state from Upstash, runs full brief generation
// (Layer A + Layer B), and writes the results back to cache so the user's
// 7 AM open finds a pre-generated brief and returns instantly.
//
// Authorization: Vercel automatically signs cron requests with the
// CRON_SECRET environment variable. We verify the Authorization header
// matches "Bearer ${CRON_SECRET}" before doing any work.
//
// Cache safety: Layer A and brief-full are written ONLY when their
// content is genuinely populated. An empty smart_money block (whales,
// congress, hedge funds all empty arrays) is treated as a failed
// generation and NOT cached — preventing poisoned cache from serving
// blank Insider Flow boxes for hours.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) redis = new Redis({ url, token });
} catch (err) {
  console.warn("Cron: Upstash init failed:", err);
}

const LAYER_A_TTL_SECONDS = 30 * 60 * 60;
const FULL_BRIEF_TTL_SECONDS = 30 * 60 * 60;

// ─── Content validation helpers ──────────────────────────────────────
// Single source of truth for "is this content actually populated".
// Used in both write guards and any future read paths.

function hasSmartMoneyContent(sm: any): boolean {
  if (!sm || typeof sm !== "object") return false;
  const whaleN = Array.isArray(sm.whale_moves) ? sm.whale_moves.length : 0;
  const congressN = Array.isArray(sm.congress_moves) ? sm.congress_moves.length : 0;
  const hedgeN = Array.isArray(sm.hedge_fund_moves) ? sm.hedge_fund_moves.length : 0;
  return (whaleN + congressN + hedgeN) > 0;
}

function hasMarketPulseContent(mp: any): boolean {
  if (!mp || typeof mp !== "object") return false;
  if (!mp.summary || typeof mp.summary !== "string" || mp.summary.length < 5) return false;
  return true;
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

// Strip <cite> tags from model output — they're meant for inline citation
// but show up as visible <cite> text in JSON strings when web_search is used.
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

// Retry wrapper for Anthropic calls — two attempts with 1.5s backoff on
// transient/5xx errors. Schema errors fail fast.
async function callWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const transient = !status || status >= 500 || status === 429;
    if (!transient) {
      console.warn(`Cron ${label}: non-retriable error:`, err?.message || err);
      throw err;
    }
    console.warn(`Cron ${label}: transient error, retrying once:`, err?.message || err);
    await new Promise((r) => setTimeout(r, 1500));
    return await fn();
  }
}

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

const COMMON_PREAMBLE = (name: string, date: string) =>
  `You are a JSON generator. Output ONLY a single valid JSON object — no prose, no markdown, no code fences. Start with { and end with }.

Generate part of a morning briefing for ${name || "the user"} on ${date}. The reader is a sophisticated multi-account swing trader who knows technical analysis, smart-money signals (13F, STOCK Act, Form 4s), and macro catalysts. No beginner advice. No filler. They invest in: AI infrastructure, semiconductors, quantum computing, crypto-mining-to-HPC, nuclear, rare earths, and speculative biotech. CRITICAL TICKER ACCURACY: Never guess company names from tickers. When in doubt, write ONLY the ticker symbol. SMMT = Summit Therapeutics (biotech), NOT Summit Materials. CIFR = Cipher Mining. APLD = Applied Digital. USAR = USA Rare Earth. SMR = NuScale. IREN = Iris Energy. PLTR = Palantir. CRWV = CoreWeave.
`;

async function generateLayerAMarket(name: string, tickers: string, date: string): Promise<any> {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, macro events, and any earnings/FDA/catalysts in the next 1-2 weeks. Watchlist for context: ${tickers}.

Return ONLY this JSON:

{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each"]
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
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Define any technical term. Use 'you'."
    }
  ]
}

todays_edge_market: 0-3 risk flags only if genuinely time-sensitive. Empty arrays fine.
radar_candidates: 8-10 high-conviction thematic stocks across AI/semis/nuclear/quantum/rare earths/biotech/crypto infra. Each entry MUST include deep_reasoning.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 6000, maxSearches: 3, label: "layerA-market" });
}

async function generateSmartMoney(name: string, date: string): Promise<any> {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 4 times to fetch the LATEST 13F disclosures, biggest insider Form 4 trades from the past 1-2 weeks, and most recent congressional STOCK Act filings.

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
    "whale_moves": [{ "text": "named trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation defining any technical term." }],
    "congress_moves": [{ "text": "named congressional trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation." }],
    "hedge_fund_moves": [{ "text": "named hedge fund trade max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation." }]
  }
}

CRITICAL DATA RULES:
- NEVER use placeholder strings like "DATA_UNAVAILABLE", "N/A", "NONE", "UNKNOWN", "TBD".
- whale_moves/congress_moves/hedge_fund_moves: 3-5 entries each. Every entry MUST be a SPECIFIC TRADE by a NAMED person/fund with a real ticker. Empty arrays fine.
- BAD examples never to include: news commentary, calendar notes, vague exposure summaries, political headlines, generic crowd statements.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 8000, maxSearches: 4, label: "smart-money" });
}

// Holdings block — IMPORTANT: cost field from the frontend is per-share
// average cost basis (Fidelity CSV format), labeled clearly to avoid the
// LLM misreading "$5.99 cost" as a total dollar value.
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
    // Per-share average cost basis — be explicit so the model doesn't confuse it with total dollars
    if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)}/share avg cost`);
    if (h.gainPct != null) {
      const sign = h.gainPct >= 0 ? "+" : "";
      parts.push(`${sign}${h.gainPct.toFixed(1)}% total return`);
    }
    return "    • " + parts.join(", ");
  };
  const groupBlocks: string[] = [];
  for (const [accountId, list] of Object.entries(groups)) {
    const label = accountId === "_unknown"
      ? "Unlabeled holdings"
      : (accountLabel[accountId] || "Account");
    groupBlocks.push(`  Account: ${label}\n${list.map(formatHolding).join("\n")}`);
  }
  const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7
    ? ` (${holdingsAgeDays} days old)` : "";
  return `\n\nUSER'S HOLDINGS${ageNote} — costs are PER-SHARE averages, NOT totals:\n${groupBlocks.join("\n\n")}\n`;
}

async function generateLightChunk(
  name: string, holdings: any[], accounts: any[] | undefined,
  holdingsAgeDays: number | null, date: string
): Promise<any> {
  const holdingsBlock = formatHoldingsBlock(holdings, accounts, holdingsAgeDays);
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount
    ? `\nMULTI-ACCOUNT: User has positions in ${accounts!.length} accounts. Every decision MUST name the account.`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}

Return ONLY this JSON:

{
  "affirmation": "short sharp opening line, max 12 words",
  "mindset": {
    "gratitude": "stimulating affirmation in Stoic warrior / Quiet power / Athlete mindset voice, max 18 words",
    "fuel": {
      "headline": "Short summary of routine in one phrase, max 14 words",
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
    "description": "4-5 sentences (110-150 words) inviting like a chef",
    "why_this_meal": "120-170 word plain-English on macros, anti-inflammatory angles, mood tie, long-term benefit",
    "groceries": ["7-10 line items with rough quantities AND brief tag on what to look for"],
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

CRITICAL: holdings 'cost' is PER-SHARE average. To get total $ basis, multiply cost × qty.

CRITICAL TICKER ACCURACY: Never guess company names. SMMT is Summit Therapeutics (NOT Summit Materials). CIFR is Cipher Mining. APLD is Applied Digital. USAR is USA Rare Earth. SMR is NuScale. IREN is Iris Energy. When in doubt, use ticker only.`;

  return callJsonChunk(prompt, { maxTokens: 8000, model: "claude-haiku-4-5", label: "light" });
}

async function generateConvictionFromContext(
  name: string, date: string, layerA: any, watchlist: string[], holdings: any[]
): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0)
    ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol)
    : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0
    ? `\nFor conviction_watch, focus on: ${focusTickers.join(", ")}.` : "";

  const contextSlice = {
    market_pulse: layerA?.market_pulse || null,
    smart_money_summary: layerA?.smart_money?.summary || null,
    sector_heatmap: layerA?.smart_money?.sector_heatmap || null,
  };

  const prompt = `${COMMON_PREAMBLE(name, date)}
You have already-fetched market context below. DO NOT search — use this directly.

MARKET CONTEXT:
${JSON.stringify(contextSlice, null, 2)}
${ownedNote}${tickerNote}

Return ONLY this JSON:

{
  "conviction_watch": [
    { "ticker": "TICKER", "signal": "add or hold or trim", "why_now": "1-2 sentences max 25 words", "note": "max 8 words", "action": "OPTIONAL trade with size max 12 words", "deep_reasoning": "130-180 word plain-English explanation defining any technical term." }
  ],
  "opportunity_watch": [
    { "ticker": "TICKER (NOT in user's holdings)", "theme": "short tag", "fits_gap": "max 14 words", "headline": "max 14 words", "deep_reasoning": "180-220 word personalized buy thesis." }
  ]
}

CRITICAL: NO web_search. Reason from context. If uncertain about a fact, omit rather than fabricate.
conviction_watch: 8-10 entries across user's positions.
opportunity_watch: 6-8 ideas NOT in user's holdings, matching themes.
NEVER use placeholders like N/A. Empty arrays acceptable.`;

  return callJsonChunk(prompt, { search: false, maxTokens: 12000, model: "claude-sonnet-4-5", label: "conviction" });
}

// Main cron handler
export async function GET(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);

  // Verify Vercel cron auth. Two valid auth methods:
  //   1. CRON_SECRET env var set → require "Authorization: Bearer ${CRON_SECRET}"
  //   2. Vercel's automatic x-vercel-cron header
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  const userAgent = request.headers.get("user-agent") || "";
  const isVercelCronUA = userAgent.includes("vercel-cron");

  if (process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!vercelCronHeader && !isVercelCronUA) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({
        error: "Set CRON_SECRET env var to enable cron auth",
      }, { status: 401 });
    }
  }

  if (!redis) {
    return NextResponse.json({ error: "Upstash not configured" }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Anthropic API key missing" }, { status: 503 });
  }

  // Read latest user state
  const userState = await redis.get<any>("latest-user-state").catch(() => null);
  if (!userState) {
    return NextResponse.json({
      ok: false,
      reason: "no user state yet — open the app at least once to seed",
    });
  }

  const { name, watchlist = [], holdings = [], accounts, holdingsAgeDays, date } = userState;
  const dateKey = todayDateString();
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";

  const startTime = Date.now();
  console.log(`[cron ${requestId}] start date=${dateKey} holdings=${holdings.length} watchlist=${watchlist.length}`);

  // Generate Layer A (market data) in parallel
  const [marketResult, smResult] = await Promise.allSettled([
    generateLayerAMarket(name, tickers, date || dateKey),
    generateSmartMoney(name, date || dateKey),
  ]);

  const layerA: any = { generatedAt: new Date().toISOString(), date: dateKey };
  if (marketResult.status === "fulfilled" && marketResult.value) {
    Object.assign(layerA, marketResult.value);
  } else if (marketResult.status === "rejected") {
    console.warn(`[cron ${requestId}] layer-a market failed:`, marketResult.reason?.message);
  }
  if (smResult.status === "fulfilled" && smResult.value) {
    Object.assign(layerA, smResult.value);
  } else if (smResult.status === "rejected") {
    console.warn(`[cron ${requestId}] smart-money failed:`, smResult.reason?.message);
  }

  // ─── Write Layer A only if BOTH market_pulse and smart_money have ──
  // genuine content. The old guard `if (market_pulse && smart_money)`
  // passed when smart_money existed as an object with empty arrays —
  // which then served as a poisoned cache for hours.
  const layerAHasContent =
    hasMarketPulseContent(layerA.market_pulse) && hasSmartMoneyContent(layerA.smart_money);
  if (layerAHasContent) {
    try {
      await redis.set(`layer-a:${dateKey}`, layerA, { ex: LAYER_A_TTL_SECONDS });
      console.log(`[cron ${requestId}] wrote layer-a (content-validated)`);
    } catch (err) {
      console.warn(`[cron ${requestId}] failed to write layer-a:`, err);
    }
  } else {
    console.warn(
      `[cron ${requestId}] SKIPPED layer-a write — market_pulse_ok=${hasMarketPulseContent(layerA.market_pulse)} smart_money_ok=${hasSmartMoneyContent(layerA.smart_money)}`
    );
  }

  // Generate Layer B in parallel
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
  const radarCandidates = Array.isArray(layerA?.radar_candidates) ? layerA.radar_candidates : [];
  const radarFiltered = radarCandidates.filter((c: any) => {
    const t = (c?.ticker || "").toUpperCase();
    return t && !ownedSet.has(t);
  }).slice(0, 6);

  const [lightResult, convictionResult] = await Promise.allSettled([
    generateLightChunk(name, holdings, accounts, holdingsAgeDays, date || dateKey),
    generateConvictionFromContext(name, date || dateKey, layerA, watchlist, holdings),
  ]);

  const merged: any = {
    todays_edge: { earnings_alerts: earningsAlerts, binary_catalysts: binaryCatalysts, risk_flags: riskFlags },
    radar_watch: radarFiltered,
  };
  if (layerA?.market_pulse) merged.market_pulse = layerA.market_pulse;
  if (layerA?.smart_money) merged.smart_money = layerA.smart_money;
  if (lightResult.status === "fulfilled" && lightResult.value) Object.assign(merged, lightResult.value);
  if (convictionResult.status === "fulfilled" && convictionResult.value) Object.assign(merged, convictionResult.value);

  // ─── Write brief-full only when smart_money has populated arrays ──
  const hHash = holdingsHash(holdings);
  const fullHasContent = hasSmartMoneyContent(merged.smart_money);
  if (fullHasContent) {
    try {
      await redis.set(`brief-full:${dateKey}:${hHash}`, merged, { ex: FULL_BRIEF_TTL_SECONDS });
      console.log(`[cron ${requestId}] wrote brief-full hash=${hHash} (content-validated)`);
    } catch (err) {
      console.warn(`[cron ${requestId}] failed to write brief-full:`, err);
    }
  } else {
    console.warn(`[cron ${requestId}] SKIPPED brief-full write — smart_money empty`);
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`[cron ${requestId}] done elapsed=${elapsedMs}ms`);

  return NextResponse.json({
    ok: true,
    requestId,
    dateKey,
    holdingsHash: hHash,
    elapsedMs,
    layerA: {
      market_pulse: hasMarketPulseContent(layerA?.market_pulse),
      smart_money: hasSmartMoneyContent(layerA?.smart_money),
      radar_candidates: radarCandidates.length,
      cached: layerAHasContent,
    },
    fullBrief: {
      keys: Object.keys(merged),
      light_ok: lightResult.status === "fulfilled",
      conviction_ok: convictionResult.status === "fulfilled",
      cached: fullHasContent,
    },
  });
}
