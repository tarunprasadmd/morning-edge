// /api/cron/generate-brief — v3 permissive Quiver parsers
// Daily 9 UTC (5 AM ET). Reads latest user state, regenerates brief, caches.
// 5/24/26: matched to brief route v3 Quiver code. Added raw-row logging.
// Super-permissive hedge fund parser: any row with a ticker counts.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

function hasSmartMoneyContent(sm: any): boolean {
  if (!sm || typeof sm !== "object") return false;
  const w = Array.isArray(sm.whale_moves) ? sm.whale_moves.length : 0;
  const c = Array.isArray(sm.congress_moves) ? sm.congress_moves.length : 0;
  const h = Array.isArray(sm.hedge_fund_moves) ? sm.hedge_fund_moves.length : 0;
  const l = Array.isArray(sm.lobbying_moves) ? sm.lobbying_moves.length : 0;
  return (w + c + h + l) > 0;
}
function hasMarketPulseContent(mp: any): boolean {
  if (!mp || typeof mp !== "object") return false;
  if (!mp.summary || typeof mp.summary !== "string" || mp.summary.length < 5) return false;
  return true;
}
function todayDateString(): string { return new Date().toISOString().slice(0, 10); }
function holdingsHash(holdings: any[]): string {
  const fp = (holdings || []).map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`).sort().join(",");
  return crypto.createHash("sha256").update(fp).digest("hex").slice(0, 16);
}

function stripCiteTags<T>(value: T): T {
  if (typeof value === "string") return value.replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, "$1").replace(/<\/?cite\b[^>]*>/gi, "").replace(/[ \t]{2,}/g, " ").trim() as any;
  if (Array.isArray(value)) return value.map((v) => stripCiteTags(v)) as any;
  if (value && typeof value === "object") { const out: any = {}; for (const [k, v] of Object.entries(value as any)) out[k] = stripCiteTags(v); return out; }
  return value;
}

async function callWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try { return await fn(); }
  catch (err: any) {
    const status = err?.status || err?.response?.status;
    const transient = !status || status >= 500 || status === 429;
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return await fn();
  }
}

async function callJsonChunk(prompt: string, opts: { search?: boolean; maxTokens?: number; maxSearches?: number; model?: string; label?: string } = {}) {
  const { search = false, maxTokens = 2500, maxSearches = 3, model = "claude-sonnet-4-5", label = "chunk" } = opts;
  const response = await callWithRetry(() => anthropic.messages.create({
    model, max_tokens: maxTokens,
    ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches } as any] } : {}),
    messages: [{ role: "user", content: prompt }],
  }), label);
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

Generate part of a morning briefing for ${name || "the user"} on ${date}. Sophisticated multi-account swing trader. AI infra, semis, quantum, crypto-mining-to-HPC, nuclear, rare earths, speculative biotech. CRITICAL TICKER ACCURACY: SMMT=Summit Therapeutics. CIFR=Cipher Mining. APLD=Applied Digital. USAR=USA Rare Earth. SMR=NuScale. IREN=Iris Energy. PLTR=Palantir. CRWV=CoreWeave.

NO CONDITIONAL ADVICE: Every action = single concrete trade. NEVER tell user to "check Form 4s," "verify," etc.
RISK TIERS: LOWER (MSFT/GOOGL/VOO), MEDIUM (IONQ/IREN/USAR), HIGHER (MOBX/PRSO/AMPX).
AGGRESSIVE DISCOVERY: include sub-$300M micro-caps with real catalysts. $300M cap floor BANNED.
`;

async function generateLayerAMarket(name: string, tickers: string, date: string): Promise<any> {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times. Watchlist: ${tickers}.
Return ONLY: { "market_pulse": { "tone": "X", "summary": "max 14 words", "key_levels": [ { "text": "max 14 words with NUMBER", "deep_context": "60-90 words" } ] }, "todays_edge_market": { "binary_catalysts": [ { "ticker": "X", "event": "date", "context": "max 12 words" } ], "risk_flags": [ { "ticker": "X", "flag": "max 12 words", "suggested_action": "max 12 words" } ] }, "radar_candidates": [ { "ticker": "X", "theme": "tag", "headline": "max 14 words", "why_now": "max 18 words", "deep_reasoning": "130-180 words" } ] }
key_levels 6-8 bullets each with specific number. radar 8-10 thematic.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 5000, maxSearches: 2, label: "layerA-market" });
}

// ─── QUIVER QUANTITATIVE — v3 permissive ─────────────────────────
const QUIVER_BASE = "https://api.quiverquant.com/beta";
const QUIVER_TIMEOUT_MS = 25000;

async function quiverFetch(path: string): Promise<any[] | null> {
  const key = process.env.QUIVER_API_KEY;
  if (!key) { console.warn(`Quiver ${path}: QUIVER_API_KEY not set`); return null; }
  const url = `${QUIVER_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUIVER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "Authorization": `Token ${key}`, "Accept": "application/json" }, signal: controller.signal });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      console.warn(`Quiver ${path}: HTTP ${res.status} | body: ${rawText.slice(0, 300)}`);
      return null;
    }
    let data: any;
    try { data = JSON.parse(rawText); }
    catch { console.warn(`Quiver ${path}: JSON parse failed | body: ${rawText.slice(0, 300)}`); return null; }
    if (Array.isArray(data)) {
      console.log(`Quiver ${path}: ${data.length} rows | first row: ${JSON.stringify(data[0] || {}).slice(0, 500)}`);
      return data;
    }
    if (Array.isArray(data?.data)) {
      console.log(`Quiver ${path}: ${data.data.length} rows (wrapped) | first row: ${JSON.stringify(data.data[0] || {}).slice(0, 500)}`);
      return data.data;
    }
    console.warn(`Quiver ${path}: unexpected shape | ${JSON.stringify(data).slice(0, 300)}`);
    return null;
  } catch (err: any) {
    clearTimeout(timer);
    console.warn(`Quiver ${path} fetch failed:`, err?.message || err);
    return null;
  }
}

function fmtMoney(v: any): string {
  if (typeof v === "string" && v.length > 0 && /\$/.test(v)) return v.trim();
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtShares(n: any): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M shares`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K shares`;
  return `${v.toFixed(0)} shares`;
}
function pickStr(row: any, ...keys: string[]): string {
  for (const k of keys) if (row && typeof row[k] === "string" && row[k].trim()) return String(row[k]).trim();
  for (const k of keys) if (row && row[k] != null) return String(row[k]).trim();
  return "";
}
function pickNum(row: any, ...keys: string[]): number {
  for (const k of keys) {
    const v = row?.[k];
    const n = typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return NaN;
}
function detectVerb(row: any): "BOUGHT" | "SOLD" | null {
  const t = (pickStr(row, "Transaction", "TransactionType", "TransactionCode", "AcquiredDisposed", "transaction") || "").toUpperCase();
  if (!t) return null;
  if (t === "P" || t.includes("PURCHASE") || t.includes("BUY") || t.includes("BOUGHT") || t.includes("ACQUI")) return "BOUGHT";
  if (t === "S" || t.includes("SALE") || t.includes("SELL") || t.includes("SOLD") || t.includes("DISPOS")) return "SOLD";
  return null;
}

async function buildCongressMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/congresstrading");
  if (!raw || raw.length === 0) return [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 60)) {
    const ticker = pickStr(row, "Ticker", "ticker").toUpperCase();
    const rep = pickStr(row, "Representative", "representative", "Name", "name").replace(/^(sen\.?|rep\.?|senator|representative)\s+/i, "").trim();
    if (!ticker || !rep) continue;
    const verb = detectVerb(row) || "BOUGHT";
    const amountRaw = pickStr(row, "Range", "Amount", "range", "amount");
    const amount = amountRaw || fmtMoney(pickNum(row, "Amount", "Value"));
    // Dedup by rep + ticker + verb + amount
    const dedupKey = `${rep}|${ticker}|${verb}|${amount}`.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const house = pickStr(row, "House", "house").toLowerCase();
    const prefix = house.includes("senate") ? "Sen " : house.includes("house") ? "Rep " : "";
    const text = `${prefix}${rep} ${verb} ${amount} ${ticker}`.replace(/\s+/g, " ").trim();
    const dateStr = pickStr(row, "TransactionDate", "Date").slice(0, 10);
    out.push({
      text, ticker,
      source_url: `https://www.capitoltrades.com/politicians?search=${encodeURIComponent(rep)}`,
      why_matters: `${rep} ${verb.toLowerCase()} ${amount || "a position in"} ${ticker}${dateStr ? ` on ${dateStr}` : ""}. Congressional STOCK Act filings have 45-day delay. Cluster trades on same ticker have historically preceded notable moves.`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

async function buildInsiderMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/insiders");
  if (!raw || raw.length === 0) return [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 60)) {
    const ticker = pickStr(row, "Ticker", "ticker").toUpperCase();
    const name = pickStr(row, "Name", "Insider", "ReporterName", "name");
    if (!ticker || !name) continue;
    const dedupKey = `${name}|${ticker}`.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const verb = detectVerb(row) || "BOUGHT";
    const shares = pickNum(row, "Shares", "shares", "SharesTransacted");
    const price = pickNum(row, "PricePerShare", "Price", "price_per_share");
    let sizeStr = "";
    if (Number.isFinite(shares) && shares > 0 && Number.isFinite(price) && price > 0) sizeStr = fmtMoney(shares * price);
    else if (Number.isFinite(shares) && shares > 0) sizeStr = fmtShares(shares);
    else sizeStr = fmtMoney(pickNum(row, "Value", "Amount"));
    const text = `${name} ${verb} ${sizeStr || "shares"} ${ticker}`.replace(/\s+/g, " ").trim();
    out.push({
      text, ticker,
      source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=&type=4&dateb=&owner=include&count=40&company=${encodeURIComponent(ticker)}`,
      why_matters: `${name} ${verb.toLowerCase()} ${sizeStr || "shares"} of ${ticker} via SEC Form 4. Insider purchases by executives and directors using personal cash are among the strongest conviction signals.`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

// MAX PERMISSIVE: accept any row with ticker.
// Diversity: cap to 2 entries per filer, dedupe by (filer+ticker).
// Iterate ALL ranked rows (not just top 500) so we can find unique filers
// even when one big fund dominates the top of the list.
async function buildHedgeFundMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/sec13fchanges");
  if (!raw || raw.length === 0) return [];
  // Rank by absolute change size so biggest moves bubble up
  const ranked = raw.map((row: any) => ({
    row,
    score: Math.abs(pickNum(row, "Value", "DollarChange", "ValueChange", "value", "Change_Value") || 0) ||
           Math.abs(pickNum(row, "Change", "SharesChange", "shares_change", "ChangeInShares", "change", "Shares") || 0),
  })).sort((a, b) => b.score - a.score);
  const out: any[] = [];
  const filerCount: Record<string, number> = {};
  const seenPair = new Set<string>();
  const MAX_PER_FILER = 2;
  for (const { row } of ranked) {
    if (out.length >= 5) break;
    const ticker = pickStr(row, "Ticker", "ticker", "Symbol").toUpperCase();
    if (!ticker) continue;
    const filer = pickStr(row, "Filer", "OwnerName", "Owner", "filer", "owner", "Reporter", "Name", "Fund", "fund") || "Hedge fund";
    const filerKey = filer.toLowerCase();
    const pairKey = `${filerKey}|${ticker}`;
    if (seenPair.has(pairKey)) continue; // exact (filer, ticker) dedupe
    if ((filerCount[filerKey] || 0) >= MAX_PER_FILER) continue; // cap per filer
    const valueChange = pickNum(row, "Value", "DollarChange", "ValueChange", "value", "Change_Value");
    const shareChange = pickNum(row, "Change", "SharesChange", "shares_change", "ChangeInShares", "change", "Shares");
    let verb: string = "ADDED";
    let sizeStr = "";
    if (Number.isFinite(valueChange) && valueChange !== 0) {
      verb = valueChange > 0 ? "ADDED" : "SOLD";
      sizeStr = fmtMoney(Math.abs(valueChange));
    } else if (Number.isFinite(shareChange) && shareChange !== 0) {
      verb = shareChange > 0 ? "ADDED" : "SOLD";
      sizeStr = fmtShares(Math.abs(shareChange));
    } else {
      const value = pickNum(row, "Value", "PositionValue", "MarketValue");
      if (Number.isFinite(value) && value > 0) { verb = "HOLDS"; sizeStr = fmtMoney(value); }
      else { verb = "FILED"; sizeStr = ""; }
    }
    filerCount[filerKey] = (filerCount[filerKey] || 0) + 1;
    seenPair.add(pairKey);
    out.push({
      text: `${filer} ${verb} ${sizeStr} ${ticker}`.replace(/\s+/g, " ").trim(),
      ticker,
      source_url: `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(filer)}%22&forms=13F-HR`,
      why_matters: `${filer} ${verb.toLowerCase()} ${sizeStr || "position in"} ${ticker} in their latest 13F filing. Quarterly 13F filings carry a 45-day reporting lag.`,
    });
  }
  return out;
}

async function buildLobbyingMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/lobbying");
  if (!raw || raw.length === 0) return [];
  const out: any[] = [];
  for (const row of raw.slice(0, 30)) {
    const ticker = pickStr(row, "Ticker", "ticker").toUpperCase();
    const client = pickStr(row, "Client", "Registrant", "client");
    const amount = pickNum(row, "Amount", "amount");
    if (!ticker || !client || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      text: `${client} SPENT ${fmtMoney(amount)} lobbying ${ticker}`,
      ticker,
      source_url: `https://www.opensecrets.org/orgs/lookup?text=${encodeURIComponent(client)}&type=lobbyer`,
      why_matters: `${client} spent ${fmtMoney(amount)} on federal lobbying. Heavy lobbying spend signals policy tailwinds or risks.`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

function buildSmartMoneySummary(allMoves: any[]): any {
  const buyTally: Record<string, number> = {}, sellTally: Record<string, number> = {};
  for (const m of allMoves) {
    const t = String(m?.ticker || "").toUpperCase();
    if (!t) continue;
    const txt = String(m?.text || "").toUpperCase();
    if (/\b(BOUGHT|ADDED)\b/.test(txt)) buyTally[t] = (buyTally[t] || 0) + 1;
    else if (/\b(SOLD|EXITED)\b/.test(txt)) sellTally[t] = (sellTally[t] || 0) + 1;
  }
  const topN = (tally: Record<string, number>, n: number) => Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  return { most_bought: topN(buyTally, 5), most_sold: topN(sellTally, 5), net_bullish_sectors: [], net_bearish_sectors: [] };
}

async function generateSmartMoney(name: string, date: string): Promise<any> {
  const startedAt = Date.now();
  const [congress, insiders, hedge, lobbying] = await Promise.allSettled([
    buildCongressMoves(), buildInsiderMoves(), buildHedgeFundMoves(), buildLobbyingMoves(),
  ]);
  const congress_moves = congress.status === "fulfilled" ? congress.value : [];
  const whale_moves = insiders.status === "fulfilled" ? insiders.value : [];
  const hedge_fund_moves = hedge.status === "fulfilled" ? hedge.value : [];
  const lobbying_moves = lobbying.status === "fulfilled" ? lobbying.value : [];
  const allMoves = [...congress_moves, ...whale_moves, ...hedge_fund_moves, ...lobbying_moves];
  console.log(`Cron Quiver smart money: ${Date.now() - startedAt}ms | congress=${congress_moves.length} insiders=${whale_moves.length} 13f=${hedge_fund_moves.length} lobbying=${lobbying_moves.length}`);
  return {
    smart_money: {
      summary: buildSmartMoneySummary(allMoves),
      sector_heatmap: [],
      whale_moves, congress_moves, hedge_fund_moves, lobbying_moves,
    },
  };
}

function formatHoldingsBlock(holdings: any[], accounts: any[] | undefined, holdingsAgeDays: number | null) {
  if (!holdings || holdings.length === 0) return "";
  const accountLabel: Record<string, string> = {};
  if (Array.isArray(accounts)) for (const a of accounts) if (a && a.id) accountLabel[a.id] = a.name || "Account";
  const groups: Record<string, any[]> = {};
  for (const h of holdings) { const key = h.accountId || "_unknown"; if (!groups[key]) groups[key] = []; groups[key].push(h); }
  const formatHolding = (h: any) => {
    const parts = [`${h.symbol}`];
    if (h.qty != null) parts.push(`${h.qty} sh`);
    if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)}/share avg cost`);
    if (h.gainPct != null) { const sign = h.gainPct >= 0 ? "+" : ""; parts.push(`${sign}${h.gainPct.toFixed(1)}% total return`); }
    return "    • " + parts.join(", ");
  };
  const groupBlocks: string[] = [];
  for (const [accountId, list] of Object.entries(groups)) {
    const label = accountId === "_unknown" ? "Unlabeled holdings" : (accountLabel[accountId] || "Account");
    groupBlocks.push(`  Account: ${label}\n${list.map(formatHolding).join("\n")}`);
  }
  const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7 ? ` (${holdingsAgeDays} days old)` : "";
  return `\n\nUSER'S HOLDINGS${ageNote} — costs are PER-SHARE averages, NOT totals:\n${groupBlocks.join("\n\n")}\n`;
}

async function generateLightChunk(name: string, holdings: any[], accounts: any[] | undefined, holdingsAgeDays: number | null, date: string) {
  const holdingsBlock = formatHoldingsBlock(holdings, accounts, holdingsAgeDays);
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount ? `\nMULTI-ACCOUNT: Every decision MUST name account.` : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}
Return ONLY this JSON: { "affirmation": "max 12 words", "mindset": { "gratitude": "max 18 words Stoic voice", "fuel": { "headline": "max 14 words", "total_min": 10, "blocks": [ { "name": "Mobility (2 min)", "moves": ["3-4"], "why": "1 sentence" }, { "name": "Breathwork (3 min)", "moves": ["2-3"], "why": "1 sentence" }, { "name": "Strength (3 min)", "moves": ["3-4"], "why": "1 sentence" }, { "name": "Cooldown (2 min)", "moves": ["2-3"], "why": "1 sentence" } ], "tip": "1-2 sentences" }, "focus": "max 10 words" }, "clarity": { "contemplation": "max 22 words", "eastern_wisdom": { "quote": "real", "source": "X" }, "breath_practice": { "name": "X", "pattern": "timing", "description": "max 24 words", "rounds": "X" } }, "power_plate": { "name": "max 6 words", "style": "Mediterranean", "protein_g": 30, "prep_min": 25, "description": "4-5 sentences", "why_this_meal": "120-170 words", "groceries": ["7-10"], "prep_steps": ["7-9 steps"], "swap_options": ["3-4"], "pairing": "2-3 sentences" }, "decisions": ["8-10 PERSONALIZED trades"], "decisions_reasoning": ["For each, 130-180 words"] }
${accountRule}
'cost' is PER-SHARE avg.`;
  return callJsonChunk(prompt, { maxTokens: 5000, model: "claude-haiku-4-5", label: "light" });
}

async function generateConvictionFromContext(name: string, date: string, layerA: any, watchlist: string[], holdings: any[]): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0) ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol) : (watchlist || []).slice(0, 5);
  const contextSlice = { market_pulse: layerA?.market_pulse || null, smart_money_summary: layerA?.smart_money?.summary || null };
  const prompt = `${COMMON_PREAMBLE(name, date)}
MARKET CONTEXT: ${JSON.stringify(contextSlice, null, 2)}${ownedNote}\nFocus: ${focusTickers.join(", ")}.
Return ONLY: { "conviction_watch": [ { "ticker": "X", "signal": "add/hold/trim", "why_now": "max 25 words", "note": "max 8 words", "action": "OPTIONAL max 12 words", "deep_reasoning": "130-180 words" } ], "opportunity_watch": [ { "ticker": "NOT held", "theme": "tag", "fits_gap": "max 14 words", "headline": "max 14 words", "deep_reasoning": "180-220 words" } ] }
NO web_search. conviction 8-10. opportunity 6-8 NOT held.`;
  return callJsonChunk(prompt, { search: false, maxTokens: 12000, model: "claude-haiku-4-5", label: "conviction" });
}

export async function GET(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const authHeader = request.headers.get("authorization");
  const userAgent = request.headers.get("user-agent") || "";
  const isVercelCronUA = userAgent.includes("vercel-cron");
  const vercelCronHeader = request.headers.get("x-vercel-cron");

  if (process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!vercelCronHeader && !isVercelCronUA) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Set CRON_SECRET env var" }, { status: 401 });
    }
  }

  if (!redis) return NextResponse.json({ error: "Upstash not configured" }, { status: 503 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 503 });

  const userState = await redis.get<any>("latest-user-state").catch(() => null);
  if (!userState) return NextResponse.json({ ok: false, reason: "no user state yet" });

  const { name, watchlist = [], holdings = [], accounts, holdingsAgeDays, date } = userState;
  const dateKey = todayDateString();
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const startTime = Date.now();
  console.log(`[cron ${requestId}] start date=${dateKey} holdings=${holdings.length} watchlist=${watchlist.length}`);

  const [marketResult, smResult] = await Promise.allSettled([
    generateLayerAMarket(name, tickers, date || dateKey),
    generateSmartMoney(name, date || dateKey),
  ]);

  const layerA: any = { generatedAt: new Date().toISOString(), date: dateKey };
  if (marketResult.status === "fulfilled" && marketResult.value) Object.assign(layerA, marketResult.value);
  if (smResult.status === "fulfilled" && smResult.value) Object.assign(layerA, smResult.value);

  if (hasMarketPulseContent(layerA.market_pulse)) {
    try { await redis.set(`layer-a:${dateKey}`, layerA, { ex: LAYER_A_TTL_SECONDS }); console.log(`[cron ${requestId}] wrote layer-a`); }
    catch (err) { console.warn(`[cron ${requestId}] failed write layer-a:`, err); }
  }

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

  const hHash = holdingsHash(holdings);
  if (hasMarketPulseContent(merged.market_pulse)) {
    try { await redis.set(`brief-full:${dateKey}:${hHash}`, merged, { ex: FULL_BRIEF_TTL_SECONDS }); console.log(`[cron ${requestId}] wrote brief-full`); }
    catch (err) { console.warn(`[cron ${requestId}] failed write brief-full:`, err); }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`[cron ${requestId}] done elapsed=${elapsedMs}ms`);

  return NextResponse.json({
    ok: true, requestId, dateKey, holdingsHash: hHash, elapsedMs,
    layerA: { market_pulse: hasMarketPulseContent(layerA?.market_pulse), smart_money: hasSmartMoneyContent(layerA?.smart_money) },
  });
}
