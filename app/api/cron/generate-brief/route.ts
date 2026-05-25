// /api/cron/generate-brief
//
// Runs daily at 5 AM ET (= 9 UTC, configured in vercel.json).
// Reads the most recent user state from Upstash, runs full brief generation
// (Layer A + Layer B), and writes the results back to cache so the user's
// 7 AM open finds a pre-generated brief and returns instantly.
//
// 5/24/26 — SMART MONEY SWAP:
//   generateSmartMoney now hits Quiver Quantitative (Trader tier) for
//   structured Congress / Insider Form 4 / 13F / Lobbying data instead
//   of AI + web_search. Mirrors the swap in /api/brief/route.ts.

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
function hasSmartMoneyContent(sm: any): boolean {
  if (!sm || typeof sm !== "object") return false;
  const whaleN = Array.isArray(sm.whale_moves) ? sm.whale_moves.length : 0;
  const congressN = Array.isArray(sm.congress_moves) ? sm.congress_moves.length : 0;
  const hedgeN = Array.isArray(sm.hedge_fund_moves) ? sm.hedge_fund_moves.length : 0;
  const lobbyN = Array.isArray(sm.lobbying_moves) ? sm.lobbying_moves.length : 0;
  return (whaleN + congressN + hedgeN + lobbyN) > 0;
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
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Define any technical term. Use 'you'."
    }
  ]
}

key_levels: 6-8 bullets. EACH bullet MUST be an object with both 'text' AND 'deep_context' fields. Vague bullets like "Tech sector strong" or "Watching the Fed" are BANNED — every bullet cites a specific number. Every bullet must pass: "Can a trader act on this?"
todays_edge_market: 0-3 risk flags only if genuinely time-sensitive. Empty arrays fine.
radar_candidates: 8-10 high-conviction thematic stocks across AI/semis/nuclear/quantum/rare earths/biotech/crypto infra. Each entry MUST include deep_reasoning.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 6000, maxSearches: 3, label: "layerA-market" });
}

// ─── QUIVER QUANTITATIVE INTEGRATION ──────────────────────────────
// Trader-tier subscription. Endpoints:
//   /beta/live/congresstrading
//   /beta/live/insiders
//   /beta/live/sec13fchanges
//   /beta/live/lobbying
const QUIVER_BASE = "https://api.quiverquant.com/beta";
const QUIVER_TIMEOUT_MS = 25000;

const SEC_EDGAR_CIKS: Record<string, string> = {
  "berkshire hathaway": "0001067983",
  "berkshire": "0001067983",
  "buffett": "0001067983",
  "warren buffett": "0001067983",
  "viking global": "0001103804",
  "renaissance technologies": "0001037389",
  "renaissance": "0001037389",
  "tiger global": "0001167483",
  "coatue": "0001135730",
  "coatue management": "0001135730",
  "bridgewater": "0001350694",
  "citadel": "0001423053",
  "citadel advisors": "0001423053",
  "two sigma": "0001179392",
  "millennium": "0001273087",
  "millennium management": "0001273087",
  "point72": "0001603466",
  "steve cohen": "0001603466",
  "de shaw": "0001009207",
  "d.e. shaw": "0001009207",
  "aqr capital": "0001167557",
  "aqr": "0001167557",
  "soros": "0001029160",
  "george soros": "0001029160",
  "lone pine": "0001061165",
  "pershing square": "0001336528",
  "ackman": "0001336528",
  "bill ackman": "0001336528",
  "greenlight capital": "0001079114",
  "einhorn": "0001079114",
  "david einhorn": "0001079114",
  "ark invest": "0001697748",
  "ark": "0001697748",
  "cathie wood": "0001697748",
  "duquesne": "0001536411",
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
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR&dateb=&owner=include&count=40`;
}

function edgarForm4ByTickerUrl(ticker: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=&type=4&dateb=&owner=include&count=40&company=${encodeURIComponent(ticker)}`;
}

function capitoltradesSearchUrl(rawName: string): string {
  const cleanName = (rawName || "")
    .replace(/^(sen\.?|rep\.?|senator|representative)\s+/i, "")
    .trim();
  return `https://www.capitoltrades.com/politicians?search=${encodeURIComponent(cleanName)}`;
}

async function quiverFetch(path: string): Promise<any[] | null> {
  const key = process.env.QUIVER_API_KEY;
  if (!key) {
    console.warn(`Quiver ${path}: QUIVER_API_KEY not set`);
    return null;
  }
  const url = `${QUIVER_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUIVER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "Authorization": `Token ${key}`,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const bodySample = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
      console.warn(`Quiver ${path}: HTTP ${res.status} ${res.statusText} | ${bodySample}`);
      return null;
    }
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any)?.data)) return (data as any).data;
    console.warn(`Quiver ${path}: unexpected response shape (keys: ${Object.keys(data || {}).join(",")})`);
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

function daysAgo(dateStr: any): number {
  if (!dateStr) return Infinity;
  const d = new Date(String(dateStr));
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function cleanPolitician(name: any): string {
  if (typeof name !== "string") return "";
  return name
    .replace(/^(sen\.?|rep\.?|senator|representative|the honorable)\s+/i, "")
    .trim();
}

function form4Verb(transaction: any): "BOUGHT" | "SOLD" | null {
  const t = String(transaction || "").toUpperCase().trim();
  if (!t) return null;
  if (t === "P" || t === "PURCHASE" || t === "BUY" || t === "BOUGHT" || t.includes("PURCHASE")) return "BOUGHT";
  if (t === "S" || t === "SALE" || t === "SELL" || t === "SOLD" || t.includes("SALE") || t.includes("SOLD")) return "SOLD";
  return null;
}

function congressVerb(transaction: any): "BOUGHT" | "SOLD" | null {
  const t = String(transaction || "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("purchase") || t.includes("buy") || t === "p") return "BOUGHT";
  if (t.includes("sale") || t.includes("sell") || t === "s") return "SOLD";
  return null;
}

function pick(row: any, keys: string[]): any {
  for (const k of keys) {
    if (row && row[k] != null && row[k] !== "") return row[k];
  }
  return undefined;
}

async function buildCongressMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/congresstrading");
  if (!raw) return [];
  if (raw.length > 0) console.log(`Cron Quiver congress: ${raw.length} rows`);
  const recent = raw.filter((row: any) => {
    const dStr = pick(row, ["TransactionDate", "Date", "transaction_date"]);
    return daysAgo(dStr) <= 60;
  });
  recent.sort((a: any, b: any) => {
    const da = new Date(String(pick(a, ["TransactionDate", "Date"]) || 0)).getTime();
    const db = new Date(String(pick(b, ["TransactionDate", "Date"]) || 0)).getTime();
    return db - da;
  });
  const out: any[] = [];
  for (const row of recent) {
    if (out.length >= 5) break;
    const verb = congressVerb(pick(row, ["Transaction"]));
    const ticker = String(pick(row, ["Ticker"]) || "").toUpperCase();
    const rep = cleanPolitician(pick(row, ["Representative", "Name"]));
    if (!verb || !ticker || !rep) continue;
    const amount = fmtMoney(pick(row, ["Range", "Amount"]));
    const house = String(pick(row, ["House"]) || "").toLowerCase();
    const prefix = house.includes("senate") ? "Sen " : house.includes("house") ? "Rep " : "";
    const text = `${prefix}${rep} ${verb} ${amount} ${ticker}`.replace(/\s+/g, " ").trim();
    const source_url = capitoltradesSearchUrl(rep);
    const dateStr = String(pick(row, ["TransactionDate", "Date"]) || "").slice(0, 10);
    out.push({
      text,
      ticker,
      source_url,
      why_matters: `${rep} ${verb.toLowerCase()} ${amount || "a position in"} ${ticker}${dateStr ? ` on ${dateStr}` : ""}. Congressional STOCK Act disclosures carry a 45-day reporting delay, but cluster activity by multiple members on the same ticker has historically preceded notable moves. Watch for follow-up filings.`,
    });
  }
  return out;
}

async function buildInsiderMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/insiders");
  if (!raw) return [];
  if (raw.length > 0) console.log(`Cron Quiver insiders: ${raw.length} rows`);
  const recent = raw.filter((row: any) => {
    const dStr = pick(row, ["Date", "FilingDate", "TransactionDate"]);
    return daysAgo(dStr) <= 21;
  });
  recent.sort((a: any, b: any) => {
    const da = new Date(String(pick(a, ["Date", "FilingDate"]) || 0)).getTime();
    const db = new Date(String(pick(b, ["Date", "FilingDate"]) || 0)).getTime();
    return db - da;
  });
  const out: any[] = [];
  for (const row of recent) {
    if (out.length >= 5) break;
    const verb = form4Verb(pick(row, ["Transaction", "AcquiredDisposed", "TransactionCode"]));
    const ticker = String(pick(row, ["Ticker"]) || "").toUpperCase();
    const name = String(pick(row, ["Name", "Insider", "ReporterName"]) || "").trim();
    if (!verb || !ticker || !name) continue;
    const shares = Number(pick(row, ["Shares", "SharesTransacted"]));
    const price = Number(pick(row, ["PricePerShare", "Price"]));
    let sizeStr = "";
    if (Number.isFinite(shares) && shares > 0) {
      if (Number.isFinite(price) && price > 0) sizeStr = fmtMoney(shares * price);
      else sizeStr = fmtShares(shares);
    }
    if (!sizeStr) continue;
    const text = `${name} ${verb} ${sizeStr} ${ticker}`;
    out.push({
      text,
      ticker,
      source_url: edgarForm4ByTickerUrl(ticker),
      why_matters: `${name} ${verb.toLowerCase()} ${sizeStr} of ${ticker} using personal cash, disclosed via SEC Form 4. Insider purchases by executives and directors are one of the strongest conviction signals — they have material non-public information about the business. Cluster buying historically precedes outperformance.`,
    });
  }
  return out;
}

async function buildHedgeFundMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/sec13fchanges");
  if (!raw) return [];
  if (raw.length > 0) console.log(`Cron Quiver 13F: ${raw.length} rows`);
  const recent = raw.filter((row: any) => {
    const dStr = pick(row, ["Date", "FilingDate", "ReportDate"]);
    return daysAgo(dStr) <= 90;
  });
  recent.sort((a: any, b: any) => {
    const va = Math.abs(Number(pick(a, ["Value", "DollarChange", "ValueChange"]) || 0));
    const vb = Math.abs(Number(pick(b, ["Value", "DollarChange", "ValueChange"]) || 0));
    if (vb !== va) return vb - va;
    const sa = Math.abs(Number(pick(a, ["Change", "SharesChange"]) || 0));
    const sb = Math.abs(Number(pick(b, ["Change", "SharesChange"]) || 0));
    return sb - sa;
  });
  const out: any[] = [];
  for (const row of recent) {
    if (out.length >= 5) break;
    const ticker = String(pick(row, ["Ticker"]) || "").toUpperCase();
    const filer = String(pick(row, ["Filer", "OwnerName", "Owner"]) || "").trim();
    if (!ticker || !filer) continue;
    const shareChange = Number(pick(row, ["Change", "SharesChange"]));
    const valueChange = Number(pick(row, ["Value", "DollarChange"]));
    let verb: "ADDED" | "SOLD" | null = null;
    let sizeStr = "";
    if (Number.isFinite(valueChange) && valueChange !== 0) {
      verb = valueChange > 0 ? "ADDED" : "SOLD";
      sizeStr = fmtMoney(Math.abs(valueChange));
    } else if (Number.isFinite(shareChange) && shareChange !== 0) {
      verb = shareChange > 0 ? "ADDED" : "SOLD";
      sizeStr = fmtShares(Math.abs(shareChange));
    }
    if (!verb || !sizeStr) continue;
    const filerLower = filer.toLowerCase();
    const cik = SEC_EDGAR_CIKS[filerLower];
    const source_url = cik
      ? edgar13FUrl(cik)
      : `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(filer)}%22&forms=13F-HR`;
    const text = `${filer} ${verb} ${sizeStr} ${ticker}`;
    out.push({
      text,
      ticker,
      source_url,
      why_matters: `${filer} ${verb.toLowerCase()} ${sizeStr} of ${ticker} in their latest 13F filing. Institutional 13F filings are quarterly and carry a 45-day reporting lag, so this reflects activity 1-3 months ago. Useful as thematic confirmation — watch for cluster moves across multiple top hedge funds on the same name.`,
    });
  }
  return out;
}

async function buildLobbyingMoves(): Promise<any[]> {
  const raw = await quiverFetch("/live/lobbying");
  if (!raw) return [];
  if (raw.length > 0) console.log(`Cron Quiver lobbying: ${raw.length} rows`);
  const recent = raw.filter((row: any) => {
    const dStr = pick(row, ["Date", "FilingDate"]);
    return daysAgo(dStr) <= 120;
  });
  recent.sort((a: any, b: any) => {
    const va = Number(pick(a, ["Amount"]) || 0);
    const vb = Number(pick(b, ["Amount"]) || 0);
    return vb - va;
  });
  const out: any[] = [];
  for (const row of recent) {
    if (out.length >= 5) break;
    const ticker = String(pick(row, ["Ticker"]) || "").toUpperCase();
    const client = String(pick(row, ["Client", "Registrant"]) || "").trim();
    const amount = Number(pick(row, ["Amount"]));
    if (!ticker || !client || !Number.isFinite(amount) || amount <= 0) continue;
    const sizeStr = fmtMoney(amount);
    const issue = String(pick(row, ["Issue", "SpecificIssues"]) || "").trim().slice(0, 60);
    const text = `${client} SPENT ${sizeStr} lobbying ${ticker}`;
    out.push({
      text,
      ticker,
      source_url: `https://www.opensecrets.org/orgs/lookup?text=${encodeURIComponent(client)}&type=lobbyer`,
      why_matters: `${client} spent ${sizeStr} on federal lobbying${issue ? ` covering ${issue}` : ""}. Heavy lobbying spend signals policy tailwinds or risks the company is actively trying to shape — defense, semis under export controls, pharma during drug-pricing fights, and crypto during regulatory shifts are classic patterns. Pair with congressional trade data on the same ticker.`,
    });
  }
  return out;
}

function buildSmartMoneySummary(allMoves: any[]): any {
  const buyTally: Record<string, number> = {};
  const sellTally: Record<string, number> = {};
  for (const m of allMoves) {
    const t = String(m?.ticker || "").toUpperCase();
    if (!t) continue;
    const txt = String(m?.text || "").toUpperCase();
    if (/\b(BOUGHT|ADDED)\b/.test(txt)) buyTally[t] = (buyTally[t] || 0) + 1;
    else if (/\b(SOLD|EXITED)\b/.test(txt)) sellTally[t] = (sellTally[t] || 0) + 1;
  }
  const topN = (tally: Record<string, number>, n: number) =>
    Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  return {
    most_bought: topN(buyTally, 5),
    most_sold: topN(sellTally, 5),
    net_bullish_sectors: [],
    net_bearish_sectors: [],
  };
}

// ─── DROP-IN REPLACEMENT — same signature as before ────────────────
async function generateSmartMoney(name: string, date: string): Promise<any> {
  const startedAt = Date.now();
  const [congress, insiders, hedge, lobbying] = await Promise.allSettled([
    buildCongressMoves(),
    buildInsiderMoves(),
    buildHedgeFundMoves(),
    buildLobbyingMoves(),
  ]);

  const congress_moves = congress.status === "fulfilled" ? congress.value : [];
  const whale_moves = insiders.status === "fulfilled" ? insiders.value : [];
  const hedge_fund_moves = hedge.status === "fulfilled" ? hedge.value : [];
  const lobbying_moves = lobbying.status === "fulfilled" ? lobbying.value : [];
  const allMoves = [...congress_moves, ...whale_moves, ...hedge_fund_moves, ...lobbying_moves];

  const elapsed = Date.now() - startedAt;
  console.log(`Cron Quiver smart money: ${elapsed}ms | congress=${congress_moves.length} insiders=${whale_moves.length} 13f=${hedge_fund_moves.length} lobbying=${lobbying_moves.length}`);

  return {
    smart_money: {
      summary: buildSmartMoneySummary(allMoves),
      sector_heatmap: [],
      whale_moves,
      congress_moves,
      hedge_fund_moves,
      lobbying_moves,
    },
  };
}

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

PLAIN ENGLISH IN THE SHORT DECISION FIELD:
- Use "shares" not "sh" or "SH"
- Use "$" + dollar gain alongside percentage when cost basis is known
- Spell out times explicitly: "at market open (9:30 AM ET)"
- BAN trader-slang: "house money", "lock 50%", "scale out", "trim into strength", "fade", "chase", "leg in"

ABSOLUTE BAN ON CONDITIONALS AND HOMEWORK:
- Every decision must be a SINGLE concrete trade. No "check if", "verify", "reassess", "wait for", "depending on", "see if".
- If you don't have data to decide cleanly: OMIT.

CRITICAL TICKER ACCURACY: Never guess. SMMT = Summit Therapeutics. CIFR = Cipher Mining. APLD = Applied Digital. USAR = USA Rare Earth. SMR = NuScale. IREN = Iris Energy.`;

  return callJsonChunk(prompt, { maxTokens: 5000, model: "claude-haiku-4-5", label: "light" });
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

  return callJsonChunk(prompt, { search: false, maxTokens: 12000, model: "claude-haiku-4-5", label: "conviction" });
}

// Main cron handler
export async function GET(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);

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

  const layerAHasContent = hasMarketPulseContent(layerA.market_pulse);
  const smartMoneyHasContent = hasSmartMoneyContent(layerA.smart_money);
  if (layerAHasContent) {
    try {
      await redis.set(`layer-a:${dateKey}`, layerA, { ex: LAYER_A_TTL_SECONDS });
      console.log(`[cron ${requestId}] wrote layer-a (market_pulse=ok smart_money=${smartMoneyHasContent ? "ok" : "empty"})`);
    } catch (err) {
      console.warn(`[cron ${requestId}] failed to write layer-a:`, err);
    }
  } else {
    console.warn(
      `[cron ${requestId}] SKIPPED layer-a write — market_pulse_ok=false`
    );
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
  const fullHasContent = hasMarketPulseContent(merged.market_pulse);
  if (fullHasContent) {
    try {
      await redis.set(`brief-full:${dateKey}:${hHash}`, merged, { ex: FULL_BRIEF_TTL_SECONDS });
      console.log(`[cron ${requestId}] wrote brief-full hash=${hHash} (smart_money=${hasSmartMoneyContent(merged.smart_money) ? "ok" : "empty"})`);
    } catch (err) {
      console.warn(`[cron ${requestId}] failed to write brief-full:`, err);
    }
  } else {
    console.warn(`[cron ${requestId}] SKIPPED brief-full write — market_pulse empty`);
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
