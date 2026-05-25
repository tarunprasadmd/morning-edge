// /api/brief — Quiver-backed smart money. v5.1: streaming paths strip hallucinated
// smart_money/market_pulse + buildHedgeFundMoves skips empty-filer rows (was capping at 2).
// Identical hedge-fund logic: MAX_PER_FILER=2, dedup by (filer+ticker),
// iterate ALL ranked rows. Mirrors /api/cron/generate-brief/route.ts.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = Math.floor(CACHE_TTL_MS / 1000);
const LAYER_A_TTL_SECONDS = 30 * 60 * 60;
const FULL_BRIEF_TTL_SECONDS = 30 * 60 * 60;
const USER_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

const briefCache = new Map<string, { brief: any; storedAt: number }>();

let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) redis = new Redis({ url, token });
} catch (err) {
  console.warn("Brief: Upstash init failed:", err);
  redis = null;
}

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
  if (typeof mp.summary !== "string" || mp.summary.length < 5) return false;
  return true;
}
function briefIsCacheable(brief: any): boolean { return hasSmartMoneyContent(brief?.smart_money); }

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_WATCHLIST = 50, MAX_HOLDINGS = 200, MAX_ACCOUNTS = 20;
const MAX_NAME_CHARS = 80, MAX_DATE_CHARS = 60, MAX_ACCOUNT_NAME_CHARS = 80;

interface ValidatedHolding { symbol: string; qty?: number; cost?: number; value?: number; gainPct?: number; accountId?: string; }
interface ValidatedAccount { id: string; name: string; brokerage?: string; }
interface ValidatedRequestBody { name: string; watchlist: string[]; holdings: ValidatedHolding[]; accounts: ValidatedAccount[]; holdingsAgeDays: number | null; date: string; forceFresh: boolean; }

function clampString(v: any, max: number): string { return typeof v !== "string" ? "" : v.slice(0, max); }

function validateBody(raw: any): { ok: true; body: ValidatedRequestBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body" };
  const name = clampString(raw.name, MAX_NAME_CHARS);
  const rawWatch = Array.isArray(raw.watchlist) ? raw.watchlist : [];
  const watchlist = Array.from(new Set(rawWatch.map((s: any) => (typeof s === "string" ? s.toUpperCase() : "")).filter((s: string) => SYMBOL_RE.test(s)))).slice(0, MAX_WATCHLIST);
  const rawHoldings = Array.isArray(raw.holdings) ? raw.holdings : [];
  const holdings: ValidatedHolding[] = [];
  for (const h of rawHoldings.slice(0, MAX_HOLDINGS)) {
    if (!h || typeof h !== "object") continue;
    const symbol = typeof h.symbol === "string" ? h.symbol.toUpperCase() : "";
    if (!SYMBOL_RE.test(symbol)) continue;
    if (!Number.isFinite(h.qty) || Number(h.qty) <= 0) continue;
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
    if (!a || typeof a !== "object" || typeof a.id !== "string") continue;
    accounts.push({ id: a.id.slice(0, 40), name: clampString(a.name, MAX_ACCOUNT_NAME_CHARS) || "Account", brokerage: clampString(a.brokerage, 40) });
  }
  const holdingsAgeDays = Number.isFinite(raw.holdingsAgeDays) ? Math.max(0, Math.floor(Number(raw.holdingsAgeDays))) : null;
  const date = clampString(raw.date, MAX_DATE_CHARS);
  return { ok: true, body: { name, watchlist: watchlist as string[], holdings, accounts, holdingsAgeDays, date, forceFresh: !!raw.forceFresh } };
}

const BRIEF_RATE_LIMIT = 60, BRIEF_RATE_WINDOW = 3600;
async function checkRateLimit(req: Request): Promise<{ ok: boolean; retryAfter: number }> {
  if (!redis) return { ok: true, retryAfter: 0 };
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const key = `ratelimit:brief:${ip}:${Math.floor(Date.now() / 1000 / BRIEF_RATE_WINDOW)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, BRIEF_RATE_WINDOW);
    if (count > BRIEF_RATE_LIMIT) return { ok: false, retryAfter: BRIEF_RATE_WINDOW };
  } catch (err) { console.warn("Brief rate limit check failed:", err); }
  return { ok: true, retryAfter: 0 };
}

function todayDateString(): string { return new Date().toISOString().slice(0, 10); }
function holdingsHash(holdings: any[]): string {
  const fp = (holdings || []).map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`).sort().join(",");
  return crypto.createHash("sha256").update(fp).digest("hex").slice(0, 16);
}

async function cacheReadFullBrief(date: string, hash: string): Promise<any | null> {
  if (!redis) return null;
  try {
    const full = await redis.get<any>(`brief-full:${date}:${hash}`);
    if (full && briefIsCacheable(full)) return full;
    return null;
  } catch (err) { console.warn("Upstash full-brief read failed:", err); return null; }
}
async function cacheWriteFullBrief(date: string, hash: string, brief: any): Promise<void> {
  if (!redis || !briefIsCacheable(brief)) return;
  try { await redis.set(`brief-full:${date}:${hash}`, brief, { ex: FULL_BRIEF_TTL_SECONDS }); }
  catch (err) { console.warn("Upstash full-brief write failed:", err); }
}
async function cacheReadLayerA(date: string): Promise<any | null> {
  if (!redis) return null;
  try {
    const layerA = await redis.get<any>(`layer-a:${date}`);
    if (layerA && hasMarketPulseContent(layerA.market_pulse) && hasSmartMoneyContent(layerA.smart_money)) return layerA;
    return null;
  } catch (err) { console.warn("Upstash layer-a read failed:", err); return null; }
}
async function cacheWriteLayerA(date: string, data: any): Promise<void> {
  if (!redis) return;
  if (!hasMarketPulseContent(data?.market_pulse) || !hasSmartMoneyContent(data?.smart_money)) return;
  try { await redis.set(`layer-a:${date}`, data, { ex: LAYER_A_TTL_SECONDS }); }
  catch (err) { console.warn("Upstash layer-a write failed:", err); }
}
async function cacheWriteUserState(state: ValidatedRequestBody): Promise<void> {
  if (!redis) return;
  try {
    await redis.set("latest-user-state", { name: state.name, watchlist: state.watchlist, holdings: state.holdings, accounts: state.accounts, holdingsAgeDays: state.holdingsAgeDays, date: state.date, savedAt: Date.now() }, { ex: USER_STATE_TTL_SECONDS });
  } catch (err) { console.warn("Upstash user-state write failed:", err); }
}

function extractLayerAFromBrief(brief: any): any | null {
  if (!brief) return null;
  const slice: any = { generatedAt: new Date().toISOString(), fromTier3: true };
  if (brief.market_pulse) slice.market_pulse = brief.market_pulse;
  if (brief.smart_money) slice.smart_money = brief.smart_money;
  if (Array.isArray(brief.radar_watch)) slice.radar_candidates = brief.radar_watch;
  if (brief.todays_edge) slice.todays_edge_market = { binary_catalysts: brief.todays_edge.binary_catalysts || [], risk_flags: brief.todays_edge.risk_flags || [] };
  return (hasMarketPulseContent(slice.market_pulse) && hasSmartMoneyContent(slice.smart_money)) ? slice : null;
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

const COMMON_PREAMBLE = (name: string, date: string) =>
  `You are a JSON generator. Output ONLY a single valid JSON object — no prose, no markdown, no code fences. Start with { and end with }.

Generate part of a morning briefing for ${name || "the user"} on ${date}. Sophisticated multi-account swing trader. AI infra, semis, quantum, crypto-mining-to-HPC, nuclear, rare earths, biotech. SMMT=Summit Therapeutics. CIFR=Cipher Mining. APLD=Applied Digital. USAR=USA Rare Earth. SMR=NuScale. IREN=Iris Energy. PLTR=Palantir. CRWV=CoreWeave.

NO CONDITIONAL ADVICE: Every action = single concrete trade.
RISK TIERS: LOWER (MSFT/GOOGL/VOO), MEDIUM (IONQ/IREN/USAR), HIGHER (MOBX/PRSO/AMPX).
AGGRESSIVE DISCOVERY: include sub-$300M micro-caps with real catalysts. $300M cap floor BANNED.
`;

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

function stripCiteTags<T>(value: T): T {
  if (typeof value === "string") return value.replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, "$1").replace(/<\/?cite\b[^>]*>/gi, "").replace(/[ \t]{2,}/g, " ").trim() as any;
  if (Array.isArray(value)) return value.map((v) => stripCiteTags(v)) as any;
  if (value && typeof value === "object") { const out: any = {}; for (const [k, v] of Object.entries(value as any)) out[k] = stripCiteTags(v); return out; }
  return value;
}

// ─── QUIVER ─────────────────────────────────────────────────────────
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
    catch (e) { console.warn(`Quiver ${path}: JSON parse failed | body: ${rawText.slice(0, 300)}`); return null; }
    if (Array.isArray(data)) {
      console.log(`Quiver ${path}: ${data.length} rows | first row: ${JSON.stringify(data[0] || {}).slice(0, 500)}`);
      return data;
    }
    if (Array.isArray(data?.data)) {
      console.log(`Quiver ${path}: ${data.data.length} rows (wrapped) | first row: ${JSON.stringify(data.data[0] || {}).slice(0, 500)}`);
      return data.data;
    }
    console.warn(`Quiver ${path}: unexpected shape | data: ${JSON.stringify(data).slice(0, 300)}`);
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
      why_matters: `${rep} ${verb.toLowerCase()} ${amount || "a position in"} ${ticker}${dateStr ? ` on ${dateStr}` : ""}. Congressional STOCK Act filings carry a 45-day reporting delay.`,
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

// Same MAX_PER_FILER=2 logic as cron file
async function buildHedgeFundMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/sec13fchanges");
  if (!raw || raw.length === 0) return [];
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
    // v5.1 FIX: Quiver's 13F primary field is "Fund" per spec. If missing,
    // skip the row entirely rather than bucketing all anonymous rows into
    // a "Hedge fund" default group that hits MAX_PER_FILER=2 and starves the rest.
    const filer = pickStr(row, "Fund", "Filer", "OwnerName", "Owner", "fund", "filer", "owner", "Reporter", "Name");
    if (!filer) continue;
    const filerKey = filer.toLowerCase();
    const pairKey = `${filerKey}|${ticker}`;
    if (seenPair.has(pairKey)) continue;
    if ((filerCount[filerKey] || 0) >= MAX_PER_FILER) continue;
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

async function generateSmartMoneyOnly(name: string, date: string) {
  const startedAt = Date.now();
  const [congress, insiders, hedge, lobbying] = await Promise.allSettled([
    buildCongressMoves(), buildInsiderMoves(), buildHedgeFundMoves(), buildLobbyingMoves(),
  ]);
  const congress_moves = congress.status === "fulfilled" ? congress.value : [];
  const whale_moves = insiders.status === "fulfilled" ? insiders.value : [];
  const hedge_fund_moves = hedge.status === "fulfilled" ? hedge.value : [];
  const lobbying_moves = lobbying.status === "fulfilled" ? lobbying.value : [];
  const allMoves = [...congress_moves, ...whale_moves, ...hedge_fund_moves, ...lobbying_moves];
  console.log(`Quiver smart money: ${Date.now() - startedAt}ms | congress=${congress_moves.length} insiders=${whale_moves.length} 13f=${hedge_fund_moves.length} lobbying=${lobbying_moves.length}`);
  return {
    smart_money: {
      summary: buildSmartMoneySummary(allMoves),
      sector_heatmap: [],
      whale_moves, congress_moves, hedge_fund_moves, lobbying_moves,
    },
  };
}

async function generateLayerAMarket(name: string, tickers: string, date: string): Promise<any> {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times. Watchlist: ${tickers}.
Return ONLY this JSON:
{ "market_pulse": { "tone": "X", "summary": "max 14 words", "key_levels": [ { "text": "max 14 words with NUMBER", "deep_context": "60-90 words" } ] }, "todays_edge_market": { "binary_catalysts": [], "risk_flags": [] }, "radar_candidates": [ { "ticker": "X", "theme": "tag", "headline": "max 14 words", "why_now": "max 18 words", "deep_reasoning": "130-180 words" } ] }
key_levels 6-8 bullets each with specific number. radar 8-10.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 4500, maxSearches: 2, label: "layerA-market" });
}

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
  return { radar_watch: candidates.filter((c: any) => { const t = (c?.ticker || "").toUpperCase(); return t && !ownedSet.has(t); }).slice(0, 6) };
}

async function generateConvictionFromContext(name: string, date: string, layerA: any, watchlist: string[], holdings: any[]): Promise<any> {
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0) ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol) : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0 ? `\nFor conviction_watch, focus on: ${focusTickers.join(", ")}.` : "";
  const contextSlice = { market_pulse: layerA?.market_pulse || null, smart_money_summary: layerA?.smart_money?.summary || null };
  const convictionPrompt = `${COMMON_PREAMBLE(name, date)}
MARKET CONTEXT: ${JSON.stringify(contextSlice, null, 2)}${ownedNote}${tickerNote}
Return ONLY: { "conviction_watch": [ { "ticker": "X", "signal": "add/hold/trim", "why_now": "max 25 words", "note": "max 8 words", "action": "OPTIONAL max 12 words", "deep_reasoning": "130-180 words" } ] }
NO web_search. 8-10 entries.`;
  const opportunityPrompt = `${COMMON_PREAMBLE(name, date)}
MARKET CONTEXT: ${JSON.stringify(contextSlice, null, 2)}${ownedNote}
Return ONLY: { "opportunity_watch": [ { "ticker": "NOT held", "theme": "tag", "fits_gap": "max 14 words", "headline": "max 14 words", "deep_reasoning": "180-220 words" } ] }
NO web_search. 6-8 NOT held.`;
  const [convResult, oppResult] = await Promise.allSettled([
    callJsonChunk(convictionPrompt, { search: false, maxTokens: 4500, model: "claude-haiku-4-5", label: "conviction-only" }),
    callJsonChunk(opportunityPrompt, { search: false, maxTokens: 4500, model: "claude-haiku-4-5", label: "opportunity-only" }),
  ]);
  const merged: any = {};
  if (convResult.status === "fulfilled" && convResult.value?.conviction_watch) merged.conviction_watch = convResult.value.conviction_watch;
  if (oppResult.status === "fulfilled" && oppResult.value?.opportunity_watch) merged.opportunity_watch = oppResult.value.opportunity_watch.filter((o: any) => !ownedSet.has((o.symbol || o.ticker || "").toUpperCase()));
  return merged;
}

async function generateLayerB(opts: any): Promise<any> {
  const { name, watchlist, holdings, accounts, holdingsAgeDays, date, layerA } = opts;
  const tasks = [
    generateLightChunk(name, holdings, accounts, holdingsAgeDays, date),
    generateConvictionFromContext(name, date, layerA, watchlist, holdings),
    generateUserAwareEdge(name, date, layerA, holdings),
    generateRadarFromCandidates(layerA, holdings),
  ];
  const results = await Promise.allSettled(tasks);
  const merged: any = {};
  for (const r of results) if (r.status === "fulfilled" && r.value) {
    // Strip authoritative fields so AI hallucinations don't overwrite layer-A
    const v: any = { ...r.value };
    delete v.smart_money;
    delete v.market_pulse;
    Object.assign(merged, v);
  }
  // Layer-A wins for these (assigned LAST so nothing overwrites)
  if (layerA?.market_pulse) merged.market_pulse = layerA.market_pulse;
  if (layerA?.smart_money) merged.smart_money = layerA.smart_money;
  if (Array.isArray(merged.opportunity_watch) && Array.isArray(merged.radar_watch)) {
    const oppT = new Set(merged.opportunity_watch.map((o: any) => (o.symbol || o.ticker || "").toUpperCase()));
    merged.radar_watch = merged.radar_watch.filter((r: any) => !oppT.has((r.symbol || r.ticker || "").toUpperCase()));
  }
  return merged;
}

async function generateLightChunk(name: string, holdings: any[], accounts: any[] | undefined, holdingsAgeDays: number | null, date: string) {
  const holdingsBlock = formatHoldingsBlock(holdings, accounts, holdingsAgeDays);
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount ? `\nMULTI-ACCOUNT: Every decision MUST name account.` : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}
Return ONLY: { "affirmation": "max 12 words", "mindset": { "gratitude": "max 18 words Stoic voice", "fuel": { "headline": "max 14 words", "total_min": 10, "blocks": [ { "name": "Mobility (2 min)", "moves": ["3-4"], "why": "1 sentence" }, { "name": "Breathwork (3 min)", "moves": ["2-3"], "why": "1 sentence" }, { "name": "Strength (3 min)", "moves": ["3-4"], "why": "1 sentence" }, { "name": "Cooldown (2 min)", "moves": ["2-3"], "why": "1 sentence" } ], "tip": "1-2 sentences" }, "focus": "max 10 words" }, "clarity": { "contemplation": "max 22 words", "eastern_wisdom": { "quote": "real", "source": "X" }, "breath_practice": { "name": "X", "pattern": "timing", "description": "max 24 words", "rounds": "X" } }, "power_plate": { "name": "max 6 words", "style": "Mediterranean", "protein_g": 30, "prep_min": 25, "description": "4-5 sentences", "why_this_meal": "120-170 words", "groceries": ["7-10"], "prep_steps": ["7-9 steps"], "swap_options": ["3-4"], "pairing": "2-3 sentences" }, "decisions": ["8-10"], "decisions_reasoning": ["each 130-180 words"] }
${accountRule}
'cost' is PER-SHARE avg.`;
  return callJsonChunk(prompt, { maxTokens: 5000, model: "claude-haiku-4-5", label: "light" });
}

async function generatePulseAndEdge(name: string, watchlist: string[], holdings: any[], date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times. Watchlist: ${tickers}.${ownedNote}
Return ONLY: { "market_pulse": { "tone": "X", "summary": "max 14 words", "key_levels": [ { "text": "max 14 words", "deep_context": "60-90 words" } ] }, "todays_edge": { "earnings_alerts": [], "binary_catalysts": [], "risk_flags": [] }, "radar_watch": [ { "ticker": "X", "theme": "tag", "headline": "max 14 words", "why_now": "max 18 words", "deep_reasoning": "130-180 words" } ] }
4-6 radar NOT in holdings.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 2800, maxSearches: 2, label: "pulse" });
}

async function generateConvictionAndOpportunity(name: string, watchlist: string[], holdings: any[], date: string) {
  const ownedSet = new Set((holdings || []).map((h: any) => (h.symbol || "").toUpperCase()));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0) ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol) : (watchlist || []).slice(0, 5);
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times.${ownedNote}\nFocus: ${focusTickers.join(", ")}.
Return ONLY: { "conviction_watch": [ { "ticker": "X", "signal": "add/hold/trim", "why_now": "max 25 words", "note": "max 8 words", "action": "OPTIONAL max 12 words", "deep_reasoning": "130-180 words" } ], "opportunity_watch": [ { "ticker": "NOT held", "theme": "tag", "fits_gap": "max 14 words", "headline": "max 14 words", "deep_reasoning": "180-220 words" } ] }
conviction 8-10. opportunity 6-8 NOT held.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 8000, maxSearches: 2, label: "conv-opp" });
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

function buildCacheKey(input: { name: string; watchlist: string[]; holdings: any[]; date: string }) {
  const holdingsFingerprint = (input.holdings || []).map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`).sort().join(",");
  const watchFingerprint = (input.watchlist || []).slice().sort().join(",");
  const raw = JSON.stringify({ n: input.name || "", w: watchFingerprint, h: holdingsFingerprint, d: input.date || "" });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function cacheWriteBrief(cacheKey: string, brief: any): Promise<void> {
  if (!briefIsCacheable(brief)) return;
  briefCache.set(cacheKey, { brief, storedAt: Date.now() });
  if (!redis) return;
  try { await redis.set(`brief:${cacheKey}`, { brief, storedAt: Date.now() }, { ex: CACHE_TTL_SECONDS }); }
  catch (err) { console.warn("Upstash brief write failed:", err); }
}

export async function POST(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();
  try {
    const rateCheck = await checkRateLimit(request);
    if (!rateCheck.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
    const url = new URL(request.url);
    const queryFresh = url.searchParams.get("fresh") === "1";
    const wantsStream = url.searchParams.get("stream") === "1";
    const rawBody = await request.json().catch(() => null);
    const validation = validateBody(rawBody);
    if (!validation.ok) return NextResponse.json({ error: (validation as any).error }, { status: 400 });
    const validBody = (validation as any).body;
    const { name, watchlist, holdings, accounts, holdingsAgeDays, date, forceFresh } = validBody;
    const fresh = queryFresh || forceFresh;
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Server missing ANTHROPIC_API_KEY" }, { status: 500 });
    cacheWriteUserState(validBody).catch(() => {});
    const dateKey = todayDateString();
    const hHash = holdingsHash(holdings);
    console.log(`[brief ${requestId}] start fresh=${fresh} stream=${wantsStream} holdings=${holdings.length} hash=${hHash}`);

    if (!fresh) {
      const cachedFull = await cacheReadFullBrief(dateKey, hHash);
      if (cachedFull) {
        const elapsed = Date.now() - startTime;
        console.log(`[brief ${requestId}] tier1 hit elapsed=${elapsed}ms`);
        if (wantsStream) return streamCachedBrief(cachedFull, requestId);
        return NextResponse.json({ brief: cachedFull, cached: true, tier: 1, _meta: { requestId, elapsedMs: elapsed } });
      }
    }

    if (!fresh) {
      const layerA = await cacheReadLayerA(dateKey);
      if (layerA) {
        if (wantsStream) {
          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              const send = (e: string, d: any) => controller.enqueue(encoder.encode(sseEncode(e, d)));
              send("chunk", { chunkName: "started", fields: {} });
              const accumulated: any = {};
              const layerAFields: any = {};
              if (layerA?.market_pulse) layerAFields.market_pulse = layerA.market_pulse;
              if (layerA?.smart_money) layerAFields.smart_money = layerA.smart_money;
              if (Object.keys(layerAFields).length > 0) { Object.assign(accumulated, layerAFields); send("chunk", { chunkName: "layer-a", fields: layerAFields }); }
              const tasks = [
                { name: "light", promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date) },
                { name: "conviction", promise: generateConvictionFromContext(name, date, layerA, watchlist, holdings) },
                { name: "edge", promise: Promise.resolve(generateUserAwareEdge(name, date, layerA, holdings)) },
                { name: "radar", promise: Promise.resolve(generateRadarFromCandidates(layerA, holdings)) },
              ];
              // v5 FIX: strip hallucinated smart_money/market_pulse from streamed chunks so layer-A wins
              const wired = tasks.map((t) => t.promise.then((val) => { if (val) { const v: any = { ...val }; delete v.smart_money; delete v.market_pulse; Object.assign(accumulated, v); send("chunk", { chunkName: t.name, fields: v }); } }, (err) => send("error", { chunkName: t.name, message: err?.message })));
              await Promise.all(wired);
              if (Array.isArray(accumulated.opportunity_watch) && Array.isArray(accumulated.radar_watch)) {
                const oppT = new Set(accumulated.opportunity_watch.map((o: any) => (o.symbol || o.ticker || "").toUpperCase()));
                accumulated.radar_watch = accumulated.radar_watch.filter((r: any) => !oppT.has((r.symbol || r.ticker || "").toUpperCase()));
              }
              if (Object.keys(accumulated).length > 0) await cacheWriteFullBrief(dateKey, hHash, accumulated);
              send("complete", { brief: accumulated, cached: false, tier: 2, _meta: { requestId } });
              send("done", {});
              controller.close();
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
        }
        try {
          const merged = await generateLayerB({ name, watchlist, holdings, accounts, holdingsAgeDays, date, layerA });
          if (merged && Object.keys(merged).length > 0) {
            await cacheWriteFullBrief(dateKey, hHash, merged);
            return NextResponse.json({ brief: merged, cached: false, tier: 2, _meta: { requestId, elapsedMs: Date.now() - startTime } });
          }
        } catch (err) { console.warn(`[brief ${requestId}] tier2 failed:`, err); }
      }
    }

    if (wantsStream) {
      const cacheKey = buildCacheKey({ name, watchlist, holdings, date });
      return streamFreshBrief({ name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey, requestId });
    }

    const tasks = [
      { name: "light", promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date) },
      { name: "pulse", promise: generatePulseAndEdge(name, watchlist, holdings, date) },
      { name: "smart_money", promise: generateSmartMoneyOnly(name, date) },
      { name: "conviction", promise: generateConvictionAndOpportunity(name, watchlist, holdings, date) },
    ];
    const results = await Promise.allSettled(tasks.map(t => t.promise));
    const merged: any = {};
    const failures: string[] = [];
    // Assign in order so smart_money (from generateSmartMoneyOnly) wins over any hallucinated field
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const taskName = tasks[i].name;
      if (r.status === "fulfilled" && r.value) {
        const v: any = { ...r.value };
        // Only the smart_money task should set smart_money
        if (taskName !== "smart_money") delete v.smart_money;
        // Only the pulse task should set market_pulse
        if (taskName !== "pulse") delete v.market_pulse;
        Object.assign(merged, v);
      } else if (r.status === "rejected") failures.push(r.reason?.message || "unknown");
    }
    if (Object.keys(merged).length === 0) return NextResponse.json({ error: `All chunks failed: ${failures.join("; ")}` }, { status: 502 });
    const cacheKey = buildCacheKey({ name, watchlist, holdings, date });
    await cacheWriteBrief(cacheKey, merged);
    await cacheWriteFullBrief(dateKey, hHash, merged);
    const synthLayerA = extractLayerAFromBrief(merged);
    if (synthLayerA) await cacheWriteLayerA(dateKey, synthLayerA);
    console.log(`[brief ${requestId}] tier3 ok elapsed=${Date.now() - startTime}ms failures=${failures.length}`);
    return NextResponse.json({ brief: merged, cached: false, tier: 3, _meta: { requestId, elapsedMs: Date.now() - startTime }, partial: failures.length > 0 ? { failedChunks: failures.length } : undefined });
  } catch (err: any) {
    console.error(`[brief ${requestId}] failed:`, err?.message || err);
    return NextResponse.json({ error: err?.message || "Unknown error", _meta: { requestId } }, { status: 500 });
  }
}

function sseEncode(eventName: string, data: any): string { return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`; }
function streamCachedBrief(brief: any, requestId: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      const e = new TextEncoder();
      controller.enqueue(e.encode(sseEncode("chunk", { chunkName: "cached", fields: brief })));
      controller.enqueue(e.encode(sseEncode("complete", { brief, cached: true, _meta: { requestId } })));
      controller.enqueue(e.encode(sseEncode("done", {})));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
function streamFreshBrief(opts: any): Response {
  const { name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey, requestId } = opts;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (eventName: string, data: any) => controller.enqueue(encoder.encode(sseEncode(eventName, data)));
      send("chunk", { chunkName: "started", fields: {} });
      const merged: any = {};
      const failures: string[] = [];
      const tasks = [
        { name: "light", promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date) },
        { name: "pulse", promise: generatePulseAndEdge(name, watchlist, holdings, date) },
        { name: "smart_money", promise: generateSmartMoneyOnly(name, date) },
        { name: "conviction", promise: generateConvictionAndOpportunity(name, watchlist, holdings, date) },
      ];
      // v5 FIX: smart_money/market_pulse fields can only be set by their authoritative task
      const wired = tasks.map((t) => t.promise.then((val) => { if (val) { const v: any = { ...val }; if (t.name !== "smart_money") delete v.smart_money; if (t.name !== "pulse") delete v.market_pulse; Object.assign(merged, v); send("chunk", { chunkName: t.name, fields: v }); } }, (err) => { failures.push(`${t.name}: ${err?.message}`); send("error", { chunkName: t.name, message: err?.message }); }));
      await Promise.all(wired);
      if (Object.keys(merged).length === 0) { send("error", { fatal: true, message: `All chunks failed: ${failures.join("; ")}` }); }
      else {
        await cacheWriteBrief(cacheKey, merged);
        const dateKey = todayDateString();
        const hHash = holdingsHash(holdings);
        await cacheWriteFullBrief(dateKey, hHash, merged);
        const synthLayerA = extractLayerAFromBrief(merged);
        if (synthLayerA) await cacheWriteLayerA(dateKey, synthLayerA);
        send("complete", { brief: merged, cached: false, _meta: { requestId }, partial: failures.length > 0 ? { failedChunks: failures.length } : undefined });
      }
      send("done", {});
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
