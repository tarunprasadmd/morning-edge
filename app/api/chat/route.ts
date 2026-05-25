// /api/chat — v2.2: Ask Morning Edge upgrade
//
// v2.2: cost basis math now uses normalized avgCostPerShare + totalCost fields
// from frontend (which applies the h.cost ambiguity heuristic before sending).
// Falls back to legacy cost-as-per-share if normalized fields absent.
// v2.1: fixed cost basis math — h.cost is PER-SHARE avg (matches brief route),
// was being treated as total which produced 100x wrong unrealized gains.
//
// The user taps "Ask about this" on any card OR the top-level "Ask Morning
// Edge" entry. Their question + conversation history flows here. Claude
// responds with full awareness of:
//   - Their portfolio (holdings + cost basis + cash)
//   - The specific card they're asking about (if any)
//   - Today's market pulse (briefSummary)
//   - Today's smart-money snapshot (whale_moves, congress_moves,
//     hedge_fund_moves, lobbying_moves) — NEW in v2
//   - Today's brief content (conviction_watch, radar_watch,
//     opportunity_watch, todays_edge) — NEW in v2
//   - LIVE market data via Yahoo Finance tools
//   - LIVE catalyst/dilution lookups via Anthropic web_search — NEW in v2
//
// Backward compatible: if smartMoney / briefSnapshot aren't passed, the
// chat still works — it just can't cite today's smart-money data. Update
// MorningEdge.jsx to pass them when ready.
//
// Model: Sonnet 4.5 (was Haiku) — needed for conviction-tier reasoning
// and the depth users pay for. ~2-4s response time.
// max_tokens: 2000 (was 1000) — room for proper rec format + reasoning.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const yahooFinance: any = new (YahooFinance as any)();

// ─── Rate limiting via Upstash INCR ──────────────────────────────────
let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) redis = new Redis({ url, token });
} catch (err) {
  console.warn("Chat: Upstash init failed; rate limiting disabled:", err);
}

const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW = 3600;

async function checkRateLimit(req: Request): Promise<{ ok: boolean; retryAfter: number }> {
  if (!redis) return { ok: true, retryAfter: 0 };
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const key = `ratelimit:chat:${ip}:${Math.floor(Date.now() / 1000 / CHAT_RATE_WINDOW)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, CHAT_RATE_WINDOW);
    if (count > CHAT_RATE_LIMIT) return { ok: false, retryAfter: CHAT_RATE_WINDOW };
  } catch (err) {
    console.warn("Chat rate limit check failed:", err);
  }
  return { ok: true, retryAfter: 0 };
}

// ─── Input validation ────────────────────────────────────────────────
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_HOLDINGS = 100;
const MAX_NAME_CHARS = 80;
const MAX_SM_MOVES = 6;       // cap each smart-money array
const MAX_BRIEF_ITEMS = 10;   // cap brief snapshot arrays
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const VALID_CARD_TYPES = new Set([
  "playbook", "conviction", "radar", "insider", "opportunity", "general",
]);

function clampString(v: any, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

// Lightweight validator for smart-money move entries
function validateSmartMoneyMove(m: any): { text: string; ticker?: string; source_url?: string; why_matters?: string } | null {
  if (!m || typeof m !== "object") return null;
  const text = clampString(m.text, 300);
  if (!text) return null;
  const tickerRaw = typeof m.ticker === "string" ? m.ticker.toUpperCase() : "";
  const ticker = SYMBOL_RE.test(tickerRaw) ? tickerRaw : undefined;
  const source_url = typeof m.source_url === "string" ? m.source_url.slice(0, 500) : undefined;
  const why_matters = clampString(m.why_matters, 500) || undefined;
  return { text, ticker, source_url, why_matters };
}

function validateBriefItem(b: any): any | null {
  if (!b || typeof b !== "object") return null;
  const tickerRaw = typeof b.ticker === "string" ? b.ticker.toUpperCase() : "";
  const ticker = SYMBOL_RE.test(tickerRaw) ? tickerRaw : "";
  if (!ticker) return null;
  return {
    ticker,
    theme: clampString(b.theme, 60),
    signal: clampString(b.signal, 30),
    headline: clampString(b.headline, 200),
    why_now: clampString(b.why_now, 300),
    note: clampString(b.note, 100),
  };
}

function validateBody(body: any): { ok: true; data: ValidatedBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, error: "No messages provided" };
  }
  if (rawMessages.length > MAX_MESSAGES) {
    return { ok: false, error: "Too many messages" };
  }
  const messages: ChatMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = clampString(m.content, MAX_MESSAGE_CHARS);
    if (!content) continue;
    messages.push({ role, content });
  }
  if (messages.length === 0) {
    return { ok: false, error: "No valid messages" };
  }

  let cardContext: CardContext | null = null;
  if (body.cardContext && typeof body.cardContext === "object") {
    const cc = body.cardContext;
    const type = VALID_CARD_TYPES.has(cc.type) ? cc.type : "general";
    const description = clampString(cc.description, MAX_DESCRIPTION_CHARS);
    const ticker = typeof cc.ticker === "string" && SYMBOL_RE.test(cc.ticker.toUpperCase())
      ? cc.ticker.toUpperCase()
      : undefined;
    if (description) {
      cardContext = { type, description, ticker };
    }
  }

  let portfolio: ValidatedBody["portfolio"] = undefined;
  if (body.portfolio && typeof body.portfolio === "object") {
    const rawHoldings = Array.isArray(body.portfolio.holdings) ? body.portfolio.holdings : [];
    const holdings: ValidatedHolding[] = [];
    for (const h of rawHoldings.slice(0, MAX_HOLDINGS)) {
      if (!h || typeof h !== "object") continue;
      const symbol = typeof h.symbol === "string" ? h.symbol.toUpperCase() : "";
      if (!SYMBOL_RE.test(symbol)) continue;
      holdings.push({
        symbol,
        qty: Number.isFinite(h.qty) ? Number(h.qty) : undefined,
        cost: Number.isFinite(h.cost) ? Number(h.cost) : undefined,
        value: Number.isFinite(h.value) ? Number(h.value) : undefined,
        gainPct: Number.isFinite(h.gainPct) ? Number(h.gainPct) : undefined,
        avgCostPerShare: Number.isFinite(h.avgCostPerShare) ? Number(h.avgCostPerShare) : undefined,
        totalCost: Number.isFinite(h.totalCost) ? Number(h.totalCost) : undefined,
      });
    }
    const cashBalance = Number.isFinite(body.portfolio.cashBalance)
      ? Number(body.portfolio.cashBalance)
      : undefined;
    if (holdings.length > 0 || cashBalance != null) {
      portfolio = { holdings, cashBalance };
    }
  }

  let briefSummary: ValidatedBody["briefSummary"] = undefined;
  if (body.briefSummary && typeof body.briefSummary === "object") {
    const bs = body.briefSummary;
    briefSummary = {
      tone: clampString(bs.tone, 60),
      summary: clampString(bs.summary, 600),
      date: clampString(bs.date, 30),
    };
  }

  // v2 NEW: smart money snapshot — optional, backward compat
  let smartMoney: ValidatedBody["smartMoney"] = undefined;
  if (body.smartMoney && typeof body.smartMoney === "object") {
    const sm = body.smartMoney;
    const validateArr = (arr: any) => Array.isArray(arr)
      ? arr.slice(0, MAX_SM_MOVES).map(validateSmartMoneyMove).filter((x): x is NonNullable<typeof x> => x !== null)
      : [];
    smartMoney = {
      whale_moves: validateArr(sm.whale_moves),
      congress_moves: validateArr(sm.congress_moves),
      hedge_fund_moves: validateArr(sm.hedge_fund_moves),
      lobbying_moves: validateArr(sm.lobbying_moves),
    };
  }

  // v2 NEW: brief snapshot — optional, backward compat
  let briefSnapshot: ValidatedBody["briefSnapshot"] = undefined;
  if (body.briefSnapshot && typeof body.briefSnapshot === "object") {
    const bn = body.briefSnapshot;
    const validateArr = (arr: any) => Array.isArray(arr)
      ? arr.slice(0, MAX_BRIEF_ITEMS).map(validateBriefItem).filter((x): x is any => x !== null)
      : [];
    let todays_edge: any = null;
    if (bn.todays_edge && typeof bn.todays_edge === "object") {
      todays_edge = {
        earnings_alerts: Array.isArray(bn.todays_edge.earnings_alerts) ? bn.todays_edge.earnings_alerts.slice(0, MAX_BRIEF_ITEMS) : [],
        binary_catalysts: Array.isArray(bn.todays_edge.binary_catalysts) ? bn.todays_edge.binary_catalysts.slice(0, MAX_BRIEF_ITEMS) : [],
        risk_flags: Array.isArray(bn.todays_edge.risk_flags) ? bn.todays_edge.risk_flags.slice(0, MAX_BRIEF_ITEMS) : [],
      };
    }
    briefSnapshot = {
      conviction_watch: validateArr(bn.conviction_watch),
      radar_watch: validateArr(bn.radar_watch),
      opportunity_watch: validateArr(bn.opportunity_watch),
      todays_edge,
    };
  }

  const userName = clampString(body.userName, MAX_NAME_CHARS);

  return {
    ok: true,
    data: { messages, cardContext, portfolio, briefSummary, smartMoney, briefSnapshot, userName },
  };
}

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface CardContext { type: "playbook" | "conviction" | "radar" | "insider" | "opportunity" | "general"; description: string; ticker?: string; }
interface ValidatedHolding { symbol: string; qty?: number; cost?: number; value?: number; gainPct?: number; avgCostPerShare?: number; totalCost?: number; }
interface SmartMoneyMove { text: string; ticker?: string; source_url?: string; why_matters?: string; }
interface ValidatedBody {
  messages: ChatMessage[];
  cardContext: CardContext | null;
  portfolio?: { holdings: ValidatedHolding[]; cashBalance?: number; };
  briefSummary?: { tone?: string; summary?: string; date?: string; };
  smartMoney?: {
    whale_moves: SmartMoneyMove[];
    congress_moves: SmartMoneyMove[];
    hedge_fund_moves: SmartMoneyMove[];
    lobbying_moves: SmartMoneyMove[];
  };
  briefSnapshot?: {
    conviction_watch: any[];
    radar_watch: any[];
    opportunity_watch: any[];
    todays_edge: { earnings_alerts: any[]; binary_catalysts: any[]; risk_flags: any[]; } | null;
  };
  userName?: string;
}

// ─── Tool definitions for Claude ─────────────────────────────────────
// Custom (Yahoo Finance) tools first, then Anthropic's built-in web_search
// which is appended at request time (different shape).
const CUSTOM_TOOLS = [
  {
    name: "get_stock_price",
    description:
      "Fetch live or most recent price data for a stock by ticker symbol. " +
      "Returns current price, today's change ($ and %), previous close, " +
      "day range, 52-week range, market cap, and trading volume. " +
      "Use this whenever the user asks about a specific stock's current " +
      "price, today's movement, or to do share-count math.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker symbol, e.g. 'NVDA', 'MSFT', 'IONQ'. Uppercase." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_stock_history",
    description:
      "Fetch historical price data for a stock over a recent window. " +
      "Returns start price, end price, percent change over the period, " +
      "high/low. Use this for questions like 'how's NVDA done this month' " +
      "or 'is IONQ still up'.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker symbol, uppercase." },
        period: {
          type: "string",
          enum: ["1w", "1m", "3m", "6m", "1y", "ytd"],
          description: "Time window — 1 week, 1/3/6 months, 1 year, or year-to-date.",
        },
      },
      required: ["symbol", "period"],
    },
  },
  {
    name: "get_market_index",
    description:
      "Fetch today's level and percent change for a major market index. " +
      "Use this for questions about the broad market, e.g. 'how's the " +
      "S&P doing today' or 'where's the VIX'.",
    input_schema: {
      type: "object" as const,
      properties: {
        index: {
          type: "string",
          enum: ["SPY", "QQQ", "DIA", "IWM", "VIX", "TLT", "GLD"],
          description: "ETF proxy: SPY=S&P 500, QQQ=Nasdaq 100, DIA=Dow, IWM=Russell 2000, VIX=volatility, TLT=long bonds, GLD=gold.",
        },
      },
      required: ["index"],
    },
  },
  {
    name: "get_multiple_quotes",
    description:
      "Fetch live price + percent change for multiple tickers at once. " +
      "Use this when the user asks about several stocks together, e.g. " +
      "'how are my AI names doing' or comparing two tickers.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: "Up to 10 ticker symbols, uppercase.",
          maxItems: 10,
        },
      },
      required: ["symbols"],
    },
  },
];

// Anthropic's server-side web search — for catalyst checks, dilution checks,
// breaking news verification. Server-side means Anthropic runs it; we don't
// execute it locally. Results flow back inline as part of the response.
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 4,
};

// ─── Tool execution (Yahoo Finance only — web_search runs server-side) ──
async function executeTool(name: string, input: any): Promise<any> {
  const t0 = Date.now();
  try {
    let result: any;
    if (name === "get_stock_price") result = await toolGetStockPrice(input);
    else if (name === "get_stock_history") result = await toolGetStockHistory(input);
    else if (name === "get_market_index") result = await toolGetStockPrice({ symbol: input?.index });
    else if (name === "get_multiple_quotes") result = await toolGetMultipleQuotes(input);
    else result = { error: `Unknown tool: ${name}` };
    const ms = Date.now() - t0;
    const ok = !result?.error;
    console.log(`[chat tool] ${name} ${ok ? "ok" : "FAIL"} input=${JSON.stringify(input).slice(0, 80)} elapsed=${ms}ms${result?.error ? ` error=${result.error}` : ""}`);
    return result;
  } catch (err: any) {
    const ms = Date.now() - t0;
    console.error(`[chat tool] ${name} EXCEPTION input=${JSON.stringify(input).slice(0, 80)} elapsed=${ms}ms err=${err?.message || err}`);
    return { error: err?.message || "Tool execution failed" };
  }
}

async function yahooQuoteWithRetry(symbol: string): Promise<any> {
  try {
    const q: any = await (yahooFinance as any).quote(symbol);
    if (q && (q.regularMarketPrice != null || q.regularMarketPreviousClose != null)) return q;
    await new Promise((r) => setTimeout(r, 400));
    return await (yahooFinance as any).quote(symbol);
  } catch (err: any) {
    await new Promise((r) => setTimeout(r, 400));
    return await (yahooFinance as any).quote(symbol);
  }
}

async function toolGetStockPrice(input: any): Promise<any> {
  const symbol = typeof input?.symbol === "string" ? input.symbol.toUpperCase() : "";
  if (!SYMBOL_RE.test(symbol)) {
    return { error: `Invalid symbol: ${input?.symbol}` };
  }
  const q: any = await yahooQuoteWithRetry(symbol);
  if (!q) return { error: `No data for symbol ${symbol}` };
  if (q.regularMarketPrice == null) {
    console.warn(`[chat tool] yahoo returned no price for ${symbol}, fields=${Object.keys(q || {}).join(",")}`);
    return { error: `Yahoo returned no price field for ${symbol}` };
  }
  return {
    symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    prevClose: q.regularMarketPreviousClose ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    weekHigh52: q.fiftyTwoWeekHigh ?? null,
    weekLow52: q.fiftyTwoWeekLow ?? null,
    marketCap: q.marketCap ?? null,
    volume: q.regularMarketVolume ?? null,
    currency: q.currency ?? "USD",
    asOf: new Date().toISOString(),
  };
}

async function toolGetStockHistory(input: any): Promise<any> {
  const symbol = typeof input?.symbol === "string" ? input.symbol.toUpperCase() : "";
  if (!SYMBOL_RE.test(symbol)) return { error: "Invalid symbol" };
  const periodMap: Record<string, { range: string; interval: string }> = {
    "1w": { range: "5d", interval: "1d" },
    "1m": { range: "1mo", interval: "1d" },
    "3m": { range: "3mo", interval: "1d" },
    "6m": { range: "6mo", interval: "1d" },
    "1y": { range: "1y", interval: "1wk" },
    "ytd": { range: "ytd", interval: "1d" },
  };
  const cfg = periodMap[input?.period] || periodMap["1m"];
  const result: any = await (yahooFinance as any).chart(symbol, {
    range: cfg.range,
    interval: cfg.interval,
    includePrePost: false,
  });
  const quotes: any[] = result?.quotes || [];
  const closes = quotes.map((q) => (q?.close != null ? Number(q.close) : null)).filter((c) => c != null) as number[];
  if (closes.length < 2) return { error: "Insufficient history" };
  const first = closes[0];
  const last = closes[closes.length - 1];
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const changePct = first !== 0 ? ((last - first) / first) * 100 : 0;
  return { symbol, period: input?.period || "1m", startPrice: first, endPrice: last, changePct, high, low, pointCount: closes.length };
}

async function toolGetMultipleQuotes(input: any): Promise<any> {
  const raw = Array.isArray(input?.symbols) ? input.symbols : [];
  const symbols = Array.from(
    new Set(
      raw
        .map((s: any) => (typeof s === "string" ? s.toUpperCase() : ""))
        .filter((s: string) => SYMBOL_RE.test(s))
    )
  ).slice(0, 10);
  if (symbols.length === 0) return { error: "No valid symbols" };
  const settled = await Promise.allSettled(symbols.map((s) => yahooQuoteWithRetry(s as string)));
  const out: Record<string, any> = {};
  settled.forEach((r, i) => {
    const sym = symbols[i] as string;
    if (r.status === "fulfilled" && r.value && r.value.regularMarketPrice != null) {
      const q: any = r.value;
      out[sym] = { price: q.regularMarketPrice, changePct: q.regularMarketChangePercent ?? null, change: q.regularMarketChange ?? null };
    } else {
      out[sym] = { error: r.status === "rejected" ? "fetch failed" : "no price data" };
    }
  });
  return { quotes: out, asOf: new Date().toISOString() };
}

// ─── Main handler ────────────────────────────────────────────────────
export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  try {
    const rateCheck = await checkRateLimit(req);
    if (!rateCheck.ok) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait an hour." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
      );
    }

    const rawBody = await req.json().catch(() => null);
    const validation = validateBody(rawBody);
    if (!validation.ok) {
      const failed = validation as { ok: false; error: string };
      return NextResponse.json({ error: failed.error }, { status: 400 });
    }
    const validData = (validation as { ok: true; data: ValidatedBody }).data;
    const { messages, cardContext, portfolio, briefSummary, smartMoney, briefSnapshot, userName } = validData;

    const systemPrompt = buildSystemPrompt({ cardContext, portfolio, briefSummary, smartMoney, briefSnapshot, userName });

    const trimmedMessages = messages.slice(-20).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Agentic loop. Custom tools (Yahoo) consume rounds via tool_use blocks.
    // web_search runs server-side within a single round (max_uses=4 per turn).
    const MAX_ROUNDS = 3;
    let conversation: any[] = [...trimmedMessages];
    let finalText = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usedTools: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await callWithRetry(() =>
        anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 2000,
          system: systemPrompt,
          tools: [...CUSTOM_TOOLS, WEB_SEARCH_TOOL] as any,
          messages: conversation,
        })
      );

      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;

      conversation.push({ role: "assistant", content: response.content });

      // Only OUR custom tool_use blocks need execution; web_search ran server-side
      const toolUseBlocks: any[] = response.content.filter((b: any) =>
        b.type === "tool_use" && CUSTOM_TOOLS.some((t) => t.name === b.name)
      ) as any[];
      const textBlocks: any[] = response.content.filter((b: any) => b.type === "text") as any[];

      // Track web_search invocations for logging
      const serverToolBlocks = response.content.filter((b: any) => b.type === "server_tool_use");
      for (const stb of serverToolBlocks) usedTools.push((stb as any).name || "web_search");

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        finalText = textBlocks.map((b: any) => b.text).join("\n").trim();
        break;
      }

      const toolResults: any[] = [];
      for (const tb of toolUseBlocks) {
        usedTools.push(tb.name);
        const result = await executeTool(tb.name, tb.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tb.id,
          content: JSON.stringify(result),
        });
      }
      conversation.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      finalText = "I had trouble looking that up just now. Try asking again, or check the price on your broker.";
    }

    console.log(`[chat ${requestId}] ok tools=${usedTools.join(",") || "none"} in=${totalInputTokens} out=${totalOutputTokens}`);

    return NextResponse.json({
      reply: finalText,
      toolsUsed: usedTools,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    });
  } catch (err: any) {
    console.error(`[chat ${requestId}] error:`, err?.message || err);
    return NextResponse.json({ error: err?.message || "Chat failed" }, { status: 500 });
  }
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const transient = !status || status >= 500 || status === 429;
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return await fn();
  }
}

// ─── Snapshot rendering helpers ──────────────────────────────────────
function renderSmartMoney(sm: ValidatedBody["smartMoney"]): string {
  if (!sm) return "";
  const sections: string[] = [];
  const renderArr = (label: string, arr: SmartMoneyMove[]) => {
    if (!arr || arr.length === 0) return;
    const lines = arr.map((m) => `  - ${m.text}${m.source_url ? ` [src: ${m.source_url}]` : ""}`).join("\n");
    sections.push(`${label}:\n${lines}`);
  };
  renderArr("Form 4 insider buys (whales)", sm.whale_moves);
  renderArr("Congressional STOCK Act trades", sm.congress_moves);
  renderArr("13F hedge fund changes", sm.hedge_fund_moves);
  renderArr("Federal lobbying spend", sm.lobbying_moves);
  if (sections.length === 0) return "";
  return `\n\nTODAY'S SMART-MONEY SNAPSHOT — use these EXACT entries when citing conviction. Do NOT invent filer names, amounts, or dates not in this list. If user asks about a ticker not below, say it isn't in today's smart-money pull and offer to web_search for fresh filings.\n\n${sections.join("\n\n")}`;
}

function renderBriefSnapshot(bn: ValidatedBody["briefSnapshot"]): string {
  if (!bn) return "";
  const parts: string[] = [];
  if (bn.conviction_watch && bn.conviction_watch.length > 0) {
    parts.push(`Conviction Watch (high-conviction positions to manage today):\n${bn.conviction_watch.map((c) => `  - ${c.ticker}${c.signal ? ` (${c.signal})` : ""}${c.why_now ? ` — ${c.why_now}` : ""}`).join("\n")}`);
  }
  if (bn.radar_watch && bn.radar_watch.length > 0) {
    parts.push(`Radar Watch (names NOT held, on the radar):\n${bn.radar_watch.map((r) => `  - ${r.ticker}${r.theme ? ` [${r.theme}]` : ""}${r.headline ? ` — ${r.headline}` : ""}`).join("\n")}`);
  }
  if (bn.opportunity_watch && bn.opportunity_watch.length > 0) {
    parts.push(`Opportunity Watch (gap-filling candidates):\n${bn.opportunity_watch.map((o) => `  - ${o.ticker}${o.theme ? ` [${o.theme}]` : ""}${o.headline ? ` — ${o.headline}` : ""}`).join("\n")}`);
  }
  if (bn.todays_edge) {
    const te = bn.todays_edge;
    if (Array.isArray(te.earnings_alerts) && te.earnings_alerts.length > 0) {
      parts.push(`Earnings alerts on user's positions:\n${te.earnings_alerts.map((e: any) => `  - ${e.ticker}${e.when ? ` (${e.when})` : ""}${e.your_shares ? ` — ${e.your_shares} shares` : ""}`).join("\n")}`);
    }
    if (Array.isArray(te.binary_catalysts) && te.binary_catalysts.length > 0) {
      parts.push(`Binary catalysts today/near-term:\n${te.binary_catalysts.map((b: any) => `  - ${b.ticker || ""}${b.event ? ` (${b.event})` : ""}${b.context ? ` — ${b.context}` : ""}`).join("\n")}`);
    }
    if (Array.isArray(te.risk_flags) && te.risk_flags.length > 0) {
      parts.push(`Risk flags:\n${te.risk_flags.map((r: any) => `  - ${r.ticker || ""}${r.flag ? ` — ${r.flag}` : ""}${r.suggested_action ? ` [action: ${r.suggested_action}]` : ""}`).join("\n")}`);
    }
  }
  if (parts.length === 0) return "";
  return `\n\nTODAY'S BRIEF CONTENT (cross-reference these when the user asks about brief items — answer specifically, not generically):\n\n${parts.join("\n\n")}`;
}

function buildSystemPrompt(ctx: {
  cardContext: CardContext | null;
  portfolio?: ValidatedBody["portfolio"];
  briefSummary?: ValidatedBody["briefSummary"];
  smartMoney?: ValidatedBody["smartMoney"];
  briefSnapshot?: ValidatedBody["briefSnapshot"];
  userName?: string;
}): string {
  const { cardContext, portfolio, briefSummary, smartMoney, briefSnapshot, userName } = ctx;

  const nowIso = new Date().toISOString();
  const nowReadable = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }) + " ET";

  let prompt = `You are Morning Edge, an AI investing copilot built into the user's daily brief app. You help the user think through specific recommendations — by giving direct, useful, personalized analysis. The user is a paying customer who expects substance, not boilerplate.

CURRENT TIME (always know this — never say "I don't have a clock"):
- ISO: ${nowIso}
- Readable: ${nowReadable}
- Market hours: NYSE/Nasdaq open 9:30 AM – 4:00 PM ET, M-F. Pre-market 4:00-9:30 AM ET. After-hours 4:00-8:00 PM ET.

CRITICAL TONE:
- Direct and concise. Phone-screen length. 2-4 short paragraphs max for normal questions.
- Talk like a thoughtful colleague who knows markets, not a corporate assistant.
- Define any technical term in the same sentence (e.g. "cost basis — what you originally paid"). Don't assume jargon.
- Use "you" and "your" — make it personal.
- Acknowledge uncertainty honestly. Don't pretend you know what the market will do.

═══════════════════════════════════════════════════════════════════
MANDATORY SMART-MONEY CONFIRMATION — applies to EVERY buy/add/watch/wait-for-level call:
═══════════════════════════════════════════════════════════════════
Before any "buy", "add", "watch", or "wait for level" call on a ticker, you MUST check four smart-money sources for confirming activity:
1. Congressional STOCK Act filings (Capitol Trades) — politician buys/sells past 14 days, especially 3+ cluster
2. SEC EDGAR Form 4 — insider buys past 7 days (executives buying with personal cash)
3. SEC EDGAR 13F — hedge fund quarterly position changes (45-day lag — confirms direction, not entry timing)
4. Trump family Form 278-T disclosures — if applicable (COIN, MSTR, MARA, HOOD, SQ, SOFI etc.)

For TODAY'S confirmation data, use the SMART-MONEY SNAPSHOT below first. If the ticker isn't in the snapshot, use web_search to look up Capitol Trades + SEC EDGAR for recent filings before answering.

CONVICTION TIERING — state inline with EVERY action recommendation:
- HIGH conviction: 3+ sources confirm same direction
- MEDIUM conviction: 1-2 sources confirm
- LOW conviction: zero sources confirm or sources conflict

Cite the specific confirming sources by name when stating conviction. Example: "Pelosi $50-100K STOCK Act filing 5/22 + 2 hedge funds adding in latest 13F = MEDIUM conviction." If the snapshot doesn't have data and web_search comes up empty, say so honestly and downgrade.

NEVER fabricate filer names, amounts, dates, ticker-source pairings, or source URLs. Use only what's in the snapshot or what you've fetched via web_search. If you cannot confirm a smart-money signal you implied, retract it.

═══════════════════════════════════════════════════════════════════
30-DAY CATALYST + DILUTION CHECK — required before any BUY call:
═══════════════════════════════════════════════════════════════════
Before recommending a buy on a name that isn't already flagged in today's brief content (see snapshot below), use web_search to verify:
1. Real catalyst within the next 30 days — earnings date, FDA event, contract decision, conference, product launch
2. Recent dilution risk — S-3 shelf filings past 60 days, ATM offerings, preferred/warrant issuance past 90 days

If no near-term catalyst, downgrade conviction or recommend WATCH instead of BUY. If dilution risk is active, flag it explicitly in the recommendation paragraph.

If web_search fails or returns nothing useful, say "I'd want to verify catalysts and dilution before committing — let me check" rather than guess.

UNIVERSAL ACTION VERB POLICY (matches the brief — applies to ALL responses):
ALLOWED action verbs only: BOUGHT, SOLD, ADDED, EXITED, HELD, AVOID, BUY, ADD, HOLD, EXIT, WATCH, WAIT.
BANNED: initiated, boosted, raised, trimmed, cut, stake (as verb), put (as verb), scaled, swung, faded, chased, legged-in, sized-up, sized-down, established (use BOUGHT), opened (use BOUGHT), closed (use SOLD), reduced (use SOLD), unloaded, dumped, accumulated (use BOUGHT).
Always pair the verb with a specific number: share count, dollar amount, or % of position. No vague "a big stake" without numbers.

TOOL USE — IMPORTANT:
- get_stock_price: WHENEVER user asks current price, today's move, share-count math, or "should I sell at the top". Don't guess prices.
- get_stock_history: for "how has X done this month/year" questions.
- get_market_index: broad market questions ("how's market today").
- get_multiple_quotes: comparing several tickers.
- web_search: catalyst/dilution checks, breaking news, smart-money lookups for tickers NOT in today's snapshot.
- Call tools BEFORE answering. If you need data and don't fetch it, you're guessing.

LIVE DATA IS MANDATORY — DO NOT USE CACHED PRICES:
- briefSummary below is hours-old narrative. NEVER use it as a source of current prices.
- ANY question that touches "what's it at now / today / current / right now" → call get_stock_price IMMEDIATELY.
- ANY question comparing tickers' current state → call get_multiple_quotes.
- ANY "how's market today" → call get_market_index.
- If you start writing a response with a specific price and haven't called a tool this turn — STOP, call the tool, then continue.
- If a tool fails, say so plainly. Do NOT silently fall back to an old number.

LIVE DATA LABELING:
- When a tool returns a price, that price IS current. State it: "NVDA $225.32 — live, just pulled."
- Change from previousClose is "intraday move" — NEVER "from yesterday's close" unless market is closed.
- NEVER invent fields the tool didn't return.

ACCOUNTABILITY TONE — NO BACKPEDALING:
- Get it right the first time. The user pays for accuracy, not apologies.
- BANNED phrases: "I apologize for the confusion", "I misspoke", "you're right, let me correct that".
- If wrong, give the correct answer plainly and move on — no multi-paragraph mea culpa.

CHAT VS BRIEF — KNOW YOUR SCOPE:
- You are the chat endpoint. You answer questions. You do NOT generate the morning brief — that's a separate system the user triggers via "Generate Brief" button.
- If user asks "generate a brief": "To regenerate your brief, tap the Generate Brief button at the top. I can summarize specific sections of your current brief, but I don't generate new briefs from this chat."

CRITICAL HONESTY RULES:
- After fetching with a tool, the price IS current — say it confidently.
- Never invent specific prices, dates, or numbers without fetching first.
- Never give absolute "buy" or "sell" instructions in legal-advice sense. Frame as the recommendation tier above + the trade — the user decides.
- This is informational. Mention this ONCE if user asks for absolute direction; don't repeat.

CRITICAL TICKER ACCURACY: Never guess what company a ticker represents. SMMT=Summit Therapeutics (biotech), NOT Summit Materials. CIFR=Cipher Mining. APLD=Applied Digital. USAR=USA Rare Earth. SMR=NuScale. IREN=Iris Energy. PLTR=Palantir. CRWV=CoreWeave. If you cannot identify a company, say so.

COMPANY IDENTITY — NEVER GUESS:
- If user names a company you don't immediately recognize, DO NOT claim it's private/public/defunct from memory.
- Ask for ticker → fetch with get_stock_price → confirm. Or say "I can't confirm without searching — give me a ticker or I'll web_search."

PERSONALIZATION RULES — THIS APP IS NOT GENERIC:
- The user pays for personalized advice. Generic "reduce volatility" lines are BANNED unless cost basis is genuinely unknown.
- Before trim/add advice on a position the user owns, check portfolio context for cost basis + share count:
  * YES: lead with unrealized $ ("you're up $X on this position"), frame trim/add in terms of locking that specific gain.
  * NO: STOP. Ask the user for cost basis BEFORE giving advice. "I don't see cost basis for [TICKER] in your sync — what did you pay per share?"
- A trim recommendation without knowing the gain is generic financial-blog content. Not what the user pays for.

TRADE SUGGESTION FORMAT — applies to EVERY action-oriented response:
- FIRST LINE: colored risk-tier circle emoji + tier label + specific action + CONVICTION TIER — bolded together.
- SECOND LINE: italic one-sentence plain-language descriptor of what the risk tier means in real terms.
- BLANK LINE.
- ONE paragraph (3-5 sentences) in plain language: smart-money sources confirming, unrealized $ when known, near-term catalyst, what would change the call.

EXAMPLES:

  🟢 **LOWER RISK · ADD 50 SHARES MSFT BELOW $410 · HIGH CONVICTION**
  *Big, profitable company. Steady grower for long-term money.*

  3 smart-money sources confirm: Pelosi STOCK Act $1-5M buy 5/12, Cathie Wood ARK 13F adding, AVGO/MSFT joint AI infra contracts. You're up 8% on existing 40 sh. Adding here drops avg cost below $415. Q4 earnings 7/30 the next catalyst — no near-term dilution risk. Reverse this call if MSFT loses $385 on volume.

  🟡 **MEDIUM RISK · ADD 100 SHARES IONQ AROUND $35 · MEDIUM CONVICTION**
  *Real business with cash, but small — stock can swing 20-30% on news.*

  [explanation paragraph]

  🔴 **HIGH RISK · BUY 500 SHARES MOBX UNDER $2.00 · LOW CONVICTION**
  *Lottery money — micro-cap, dilution risk, only invest what you're okay losing 100% of.*

  [explanation paragraph]

  ⚪ **HOLD CIFR — NO ACTION TODAY · MEDIUM CONVICTION**
  *Your setup is still working — let it run.*

  [explanation paragraph]

RISK TIER ASSIGNMENT:
- 🟢 LOWER RISK — large-cap >$10B, profitable, diversified revenue (MSFT, GOOGL, AAPL, NVDA, META, VOO, SCHD, BND, GE, JNJ, MRK, UNH).
- 🟡 MEDIUM RISK — $1B-$10B, real revenue+cash, can swing 20-30% on news (IONQ, IREN, USAR, CRWV, LAES, BBAI, SMR, APLD, WULF, CIFR, VKTX).
- 🔴 HIGH RISK — <$1B, speculative, dilution-prone or pre-revenue (MOBX, PRSO, AMPX, SNAL, QUCY, IVDA, SIDU, LLAP).
- ⚪ NO NEW RISK — HOLD/WATCH/WAIT (no new money). For EXIT calls, use the tier matching the position's tier.

For general questions (definitions, education) you do NOT need this format — only for actionable recs.

SMALL-CAP DISCOVERY FILTERS — apply ONLY when user explicitly asks for "small-cap / micro-cap / penny / sub-$5 / lottery / catalyst / screener / discovery / what's running / M&A / merger / acquisition / contract play".

DEFAULT POSTURE WHEN TRIGGERED: AGGRESSIVE, not conservative. User wants asymmetric setups, not wealth-manager-safe names. Find the next MOBX-type opportunity BEFORE it moves. Do not retreat to mega-cap "safer" alternatives unless asked.

PRIORITIZE CATALYST CATEGORIES:
- M&A / LOI / merger talks
- Defense contract wins (TSA scanner orders, F-22 Raptor, anti-drone)
- Rare earth / critical minerals / sovereign supply chain
- Drone / Replicator Initiative defense suppliers
- FDA / clinical milestone reads
- SEC filings disclosing material new partnerships or government contracts

INCLUDES:
- Market cap $10M-$2B (NO $300M floor — screened out MOBX before its 80%+ pop)
- Price $0.30-$5.00
- Real catalyst past 90 days (SEC filing, contract, LOI, FDA event, defense award)
- NASDAQ or NYSE (no OTC pink sheets)
- ≥1 analyst target above current price OR no coverage at all
- Avg daily volume >100K shares

EXCLUDES:
- Already up >50% intraday (don't chase post-pop)
- Bid <$0.50 AND no active catalyst
- Reverse split announced past 30 days
- Already-delisted tickers

DO NOT use these auto-disqualifiers:
- "Revenue too low" / "no analyst coverage" / "chronic dilution history" / "prior reverse split older than 30 days" / "negative beta"

Before recommending from this filter, use get_stock_price + web_search to verify candidate is live, tradeable, and has the cited catalyst. Do NOT surface candidates from memory alone — training data is stale.

CONTEXT YOU HAVE:`;

  if (userName) {
    prompt += `\n\nUser's name: ${userName}`;
  }

  if (briefSummary?.tone || briefSummary?.summary) {
    prompt += `\n\nToday's market read (from this morning's brief):
- Tone: ${briefSummary.tone || "unknown"}
- Summary: ${briefSummary.summary || "no summary"}`;
    if (briefSummary.date) prompt += `\n- Date: ${briefSummary.date}`;
  }

  // v2: smart-money snapshot
  prompt += renderSmartMoney(smartMoney);

  // v2: brief content snapshot
  prompt += renderBriefSnapshot(briefSnapshot);

  if (portfolio?.holdings && portfolio.holdings.length > 0) {
    const totalValue = portfolio.holdings.reduce((sum, h) => sum + (h.value || 0), 0);
    prompt += `\n\nUser's portfolio:`;
    if (typeof portfolio.cashBalance === "number") {
      prompt += `\n- Available cash to deploy: $${portfolio.cashBalance.toLocaleString()}`;
    } else {
      prompt += `\n- Cash balance: not synced. If they ask about share counts, ask how much cash they want to deploy.`;
    }
    prompt += `\n- Total holdings value: ~$${totalValue.toLocaleString()}`;
    prompt += `\n- Positions: ${portfolio.holdings.length} holdings`;
    let withCost = 0;
    const sorted = [...portfolio.holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
    prompt += `\n- Full positions list (use these EXACT numbers; do NOT estimate gains):`;
    for (const h of sorted) {
      const parts: string[] = [h.symbol];
      if (h.qty != null) parts.push(`${h.qty}sh`);
      if (h.value != null) parts.push(`$${Math.round(h.value).toLocaleString()}`);
      if (h.qty != null && h.qty > 0 && ((h.avgCostPerShare != null && h.avgCostPerShare > 0) || (h.cost != null && h.cost > 0))) {
        withCost++;
        // v2.2: Prefer explicit normalized fields from frontend. The frontend
        // applies the cost-basis heuristic before sending (handles ambiguous
        // h.cost cases — per-share vs total — using gainPct cross-check and
        // 5x ratio rule). If normalized fields missing (older client), fall
        // back to treating h.cost as per-share (matches brief route).
        const avgCostPerShare = (h.avgCostPerShare != null && h.avgCostPerShare > 0)
          ? h.avgCostPerShare
          : (h.cost as number);
        const totalCost = (h.totalCost != null && h.totalCost > 0)
          ? h.totalCost
          : avgCostPerShare * h.qty;
        const unreal = (h.value ?? 0) - totalCost;
        const pct = totalCost > 0 ? (unreal / totalCost) * 100 : 0;
        const sign = unreal >= 0 ? "+" : "";
        parts.push(`avg $${avgCostPerShare.toFixed(2)}/sh`);
        parts.push(`total cost $${Math.round(totalCost).toLocaleString()}`);
        parts.push(`unrealized ${sign}$${Math.round(unreal).toLocaleString()} (${sign}${pct.toFixed(1)}%)`);
      } else if (h.gainPct != null) {
        const sign = h.gainPct >= 0 ? "+" : "";
        parts.push(`${sign}${h.gainPct.toFixed(1)}%`);
      }
      prompt += `\n  - ${parts.join(" · ")}`;
    }
    if (withCost === 0) {
      prompt += `\n\nDYNAMIC COVERAGE CHECK: Cost basis MISSING for every position. Do NOT give trim/add advice that assumes a gain percentage. If user asks for trim/add, ASK for cost basis first.`;
    } else if (withCost < portfolio.holdings.length) {
      prompt += `\n\nDYNAMIC COVERAGE CHECK: Cost basis known for ${withCost} of ${portfolio.holdings.length} positions. If asked about a position WITHOUT cost basis above, ask user for it before trim/add advice.`;
    }
  } else {
    prompt += `\n\nUser's portfolio: not synced. If they ask about position sizing, ask for cash balance.`;
  }

  if (cardContext) {
    prompt += `\n\nThe user is asking about this specific item from their brief:
[${cardContext.type.toUpperCase()}${cardContext.ticker ? ` · ${cardContext.ticker}` : ""}]
${cardContext.description}

Their questions will likely be about this item. Stay focused on it unless they change topic. If this card has a ticker, fetch its current price with get_stock_price when the user asks about timing, sizing, or "is it still a good level."`;
  }

  prompt += `\n\nKeep responses concise. Start with the answer, then briefly explain. End by inviting a follow-up if helpful.`;

  return prompt;
}
