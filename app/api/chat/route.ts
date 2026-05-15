// /api/chat — interactive chat about a specific card from today's brief.
//
// The user taps "Ask about this" on any card (Playbook decision, Conviction
// Watch entry, Radar item, Insider Flow row), which opens a chat sheet
// pre-loaded with the card's context. Their question + conversation history
// flows here. Claude responds with full awareness of:
//   - The specific card they're asking about
//   - Their portfolio (holdings + cash balance, if synced)
//   - Today's market pulse (so we know the day's tone)
//   - LIVE MARKET DATA via tool use (real prices, percent changes,
//     today's news, market movers — sourced from Yahoo Finance)
//
// Tool use: Claude can call get_stock_price / get_stock_history /
// get_market_movers / get_market_index. We loop until Claude returns a
// final text answer (no further tool_use blocks). Hard cap at 5 rounds.
//
// Uses Sonnet 4 for nuance + speed. Up to 1200 max_tokens per response
// (a bit higher than before to accommodate tool-aware reasoning).

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

// yahoo-finance2 v3 requires instantiation (changed from v2 singleton)
const yahooFinance: any = new (YahooFinance as any)();

// ─── Rate limiting via Upstash INCR ──────────────────────────────────
// Defends against abuse if the endpoint is ever crawled or hit by a
// runaway client. 30 chat requests per hour per IP is generous for
// real users but well below what an abuser would generate.
//
// Silently disabled if Upstash isn't configured (local dev).
let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) redis = new Redis({ url, token });
} catch (err) {
  console.warn("Chat: Upstash init failed; rate limiting disabled:", err);
}

const CHAT_RATE_LIMIT = 30;       // requests per hour
const CHAT_RATE_WINDOW = 3600;    // seconds

async function checkRateLimit(req: Request): Promise<{ ok: boolean; retryAfter: number }> {
  if (!redis) return { ok: true, retryAfter: 0 };
  // x-forwarded-for is set by Vercel's edge to the real client IP
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const key = `ratelimit:chat:${ip}:${Math.floor(Date.now() / 1000 / CHAT_RATE_WINDOW)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, CHAT_RATE_WINDOW);
    if (count > CHAT_RATE_LIMIT) return { ok: false, retryAfter: CHAT_RATE_WINDOW };
  } catch (err) {
    // Don't block on rate limiter failure — log and allow.
    console.warn("Chat rate limit check failed:", err);
  }
  return { ok: true, retryAfter: 0 };
}

// ─── Input validation ────────────────────────────────────────────────
// Defends against prompt injection and oversize payloads.
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_HOLDINGS = 100;
const MAX_NAME_CHARS = 80;
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const VALID_CARD_TYPES = new Set([
  "playbook",
  "conviction",
  "radar",
  "insider",
  "opportunity",
  "general",
]);

function clampString(v: any, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
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

  // cardContext
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

  // portfolio — accept up to 100 holdings, validate each
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
      });
    }
    const cashBalance = Number.isFinite(body.portfolio.cashBalance)
      ? Number(body.portfolio.cashBalance)
      : undefined;
    if (holdings.length > 0 || cashBalance != null) {
      portfolio = { holdings, cashBalance };
    }
  }

  // briefSummary
  let briefSummary: ValidatedBody["briefSummary"] = undefined;
  if (body.briefSummary && typeof body.briefSummary === "object") {
    const bs = body.briefSummary;
    briefSummary = {
      tone: clampString(bs.tone, 60),
      summary: clampString(bs.summary, 600),
      date: clampString(bs.date, 30),
    };
  }

  const userName = clampString(body.userName, MAX_NAME_CHARS);

  return {
    ok: true,
    data: { messages, cardContext, portfolio, briefSummary, userName },
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
interface CardContext {
  type: "playbook" | "conviction" | "radar" | "insider" | "opportunity" | "general";
  description: string;
  ticker?: string;
}
interface ValidatedHolding {
  symbol: string;
  qty?: number;
  cost?: number;
  value?: number;
  gainPct?: number;
}
interface ValidatedBody {
  messages: ChatMessage[];
  cardContext: CardContext | null;
  portfolio?: {
    holdings: ValidatedHolding[];
    cashBalance?: number;
  };
  briefSummary?: {
    tone?: string;
    summary?: string;
    date?: string;
  };
  userName?: string;
}

// ─── Tool definitions for Claude ─────────────────────────────────────
// These are what Claude can call mid-conversation to fetch real data.
// Names + descriptions are deliberately specific so the model picks the
// right tool with minimal back-and-forth.
const TOOLS = [
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
        symbol: {
          type: "string",
          description: "Ticker symbol, e.g. 'NVDA', 'MSFT', 'IONQ'. Uppercase.",
        },
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
        symbol: {
          type: "string",
          description: "Ticker symbol, uppercase.",
        },
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
          description:
            "ETF proxy: SPY=S&P 500, QQQ=Nasdaq 100, DIA=Dow, " +
            "IWM=Russell 2000, VIX=volatility, TLT=long bonds, GLD=gold.",
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

// ─── Tool execution ──────────────────────────────────────────────────
// Each handler returns a compact JSON-able object. Errors are returned
// as { error: "..." } so Claude can recover and continue the chat.
// Verbose logging on every call so Vercel runtime logs let us see
// exactly what yahoo-finance2 returned if a future call fails.
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

// Retry wrapper specifically for yahoo-finance2 calls. The first call from a
// cold serverless function sometimes returns auth/cookie redirects that fail
// silently. One retry after 400ms gives the library time to settle.
async function yahooQuoteWithRetry(symbol: string): Promise<any> {
  try {
    const q: any = await (yahooFinance as any).quote(symbol);
    if (q && (q.regularMarketPrice != null || q.regularMarketPreviousClose != null)) return q;
    // Empty/null response — retry once
    await new Promise((r) => setTimeout(r, 400));
    return await (yahooFinance as any).quote(symbol);
  } catch (err: any) {
    // First call threw — retry once
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
  return {
    symbol,
    period: input?.period || "1m",
    startPrice: first,
    endPrice: last,
    changePct,
    high,
    low,
    pointCount: closes.length,
  };
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
  const settled = await Promise.allSettled(
    symbols.map((s) => yahooQuoteWithRetry(s as string))
  );
  const out: Record<string, any> = {};
  settled.forEach((r, i) => {
    const sym = symbols[i] as string;
    if (r.status === "fulfilled" && r.value && r.value.regularMarketPrice != null) {
      const q: any = r.value;
      out[sym] = {
        price: q.regularMarketPrice,
        changePct: q.regularMarketChangePercent ?? null,
        change: q.regularMarketChange ?? null,
      };
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
    // Rate limit first
    const rateCheck = await checkRateLimit(req);
    if (!rateCheck.ok) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait an hour." },
        {
          status: 429,
          headers: { "Retry-After": String(rateCheck.retryAfter) },
        }
      );
    }

    const rawBody = await req.json().catch(() => null);
    const validation = validateBody(rawBody);
    if (!validation.ok) {
      const failed = validation as { ok: false; error: string };
      return NextResponse.json({ error: failed.error }, { status: 400 });
    }
    const validData = (validation as { ok: true; data: ValidatedBody }).data;
    const { messages, cardContext, portfolio, briefSummary, userName } = validData;

    const systemPrompt = buildSystemPrompt({ cardContext, portfolio, briefSummary, userName });

    // Trim to last 20 turns to keep costs predictable on long chats.
    const trimmedMessages = messages.slice(-20).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // ─── Agentic tool-use loop ──────────────────────────────────────
    // Up to 3 rounds (was 5 — most queries resolve in 1-2). Each round:
    // call Claude; if tool_use blocks come back, execute them and append
    // tool_result; loop. Otherwise extract final text and return.
    // Using Haiku 4.5 instead of Sonnet for 3-5x faster responses — the
    // chat is structured by the system prompt format, doesn't need Sonnet
    // depth for stock Q&A with live tools.
    const MAX_ROUNDS = 3;
    let conversation: any[] = [...trimmedMessages];
    let finalText = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usedTools: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await callWithRetry(() =>
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          system: systemPrompt,
          tools: TOOLS as any,
          messages: conversation,
        })
      );

      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;

      // Append the assistant's response (text + tool_use blocks) to conversation
      conversation.push({ role: "assistant", content: response.content });

      // Collect any tool_use blocks
      const toolUseBlocks: any[] = response.content.filter((b: any) => b.type === "tool_use") as any[];
      const textBlocks: any[] = response.content.filter((b: any) => b.type === "text") as any[];

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        // No more tools to run — collect text and exit
        finalText = textBlocks.map((b: any) => b.text).join("\n").trim();
        break;
      }

      // Execute each tool and build the tool_result content for next turn
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
      // Last-resort fallback if the loop ended without final text
      finalText =
        "I had trouble looking that up just now. Try asking again, or check the price on your broker.";
    }

    console.log(`[chat ${requestId}] ok tools=${usedTools.join(",") || "none"} in=${totalInputTokens} out=${totalOutputTokens}`);

    return NextResponse.json({
      reply: finalText,
      toolsUsed: usedTools,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
    });
  } catch (err: any) {
    console.error(`[chat ${requestId}] error:`, err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Chat failed" },
      { status: 500 }
    );
  }
}

// Retry wrapper for Anthropic calls. Two attempts, 500ms apart.
// Only retries on transient/5xx errors — schema errors fail fast.
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

function buildSystemPrompt(ctx: {
  cardContext: CardContext | null;
  portfolio?: ValidatedBody["portfolio"];
  briefSummary?: ValidatedBody["briefSummary"];
  userName?: string;
}): string {
  const { cardContext, portfolio, briefSummary, userName } = ctx;

  // Inject current time so the AI ALWAYS knows what time it is.
  // No more "I don't have a clock" responses — that's evasive.
  const nowIso = new Date().toISOString();
  const nowReadable = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }) + " ET";

  let prompt = `You are Morning Edge, an AI investing copilot built into the user's daily brief app. You help the user think through specific recommendations from their brief — by giving direct, useful, personalized analysis.

CURRENT TIME (always know this — never say "I don't have a clock"):
- ISO: ${nowIso}
- Readable: ${nowReadable}
- If the user asks the time, the date, or "how stale is this data" — answer directly from the values above. Do NOT say you don't have a clock.
- Market hours: NYSE/Nasdaq are open 9:30 AM – 4:00 PM ET, Monday-Friday. Use the time above to determine if the market is open, in pre-market (4:00-9:30 AM ET), after-hours (4:00-8:00 PM ET), or closed (overnight/weekend).

CRITICAL TONE:
- Be direct and concise. Phone-screen length responses. 2-4 short paragraphs max for normal questions.
- Talk like a thoughtful friend who happens to know markets, not a corporate assistant.
- Write for someone NEW to trading. Define any technical term in the same sentence you use it (e.g. "cost basis — what you originally paid for the stock"). Never assume the reader knows trading slang.
- Use "you" and "your" to make it personal.
- When the user asks how many shares they can buy, fetch the live price with get_stock_price, then do the math.
- When the user is unsure about timing, give them a framework for thinking about it, not a prediction.
- Acknowledge uncertainty honestly. Don't pretend you know what the market will do.

TOOL USE — IMPORTANT:
You have tools that fetch live market data (Yahoo Finance, no extra cost).
- USE get_stock_price WHENEVER the user asks about a current price, today's move, share-count math, or "should I sell at the top". Don't guess prices.
- USE get_stock_history for "how has X done this month/year" type questions.
- USE get_market_index for broad market questions ("how's the market doing today").
- USE get_multiple_quotes when comparing several tickers.
- Call tools BEFORE answering. If you need data and don't fetch it, you're guessing — that's worse than admitting you need to look.
- After the tool returns, weave the numbers into a natural answer. Don't say "I called a tool" — just give the answer.

LIVE DATA IS MANDATORY — DO NOT USE CACHED PRICES:
- briefSummary is hours-old narrative context. NEVER use it as a source of current prices, today's move, or where a stock is trading right now.
- ANY question that touches "what's it at now / today / current / right now / where is it / is it up or down" → call get_stock_price IMMEDIATELY before forming an answer.
- ANY question comparing two or more tickers' current state → call get_multiple_quotes.
- ANY "how's the market doing today" question → call get_market_index.
- If you start writing a response that includes a specific price or percent move and you have NOT yet called a tool this turn — STOP, call the tool, then continue. This is non-negotiable.
- If a tool fails, say so plainly ("I tried to pull the live price for X but Yahoo didn't return data — try refreshing your broker"). Do NOT silently fall back to an old number.

LIVE DATA LABELING — ACCURACY ON FRAMING:
- When a tool returns a price, that price IS current as of seconds ago. State it that way: "NVDA $225.32 — live, just pulled."
- The tool also returns previousClose. The change from previousClose is "intraday move" or "today's move" — NEVER "from yesterday's close" unless the market is currently closed and previousClose is literally yesterday's session close.
- If you don't know whether the market is open right now, USE THE CURRENT TIME ABOVE to determine this. Market hours: 9:30 AM – 4:00 PM ET, M-F.
- NEVER invent fields the tool didn't return. If the tool returned only current price + previousClose, do NOT make up "52-week range", "1-year performance", or any other figure unless you called another tool for it. Made-up framing is worse than no framing.
- Format every live-data response cleanly: ticker + current price + how it was pulled + the change with correct framing. No flowery prose.

ACCOUNTABILITY TONE — NO BACKPEDALING:
- Get it right the first time. The user pays for accuracy, not apologies.
- Do NOT use phrases like "I apologize for the confusion", "I misspoke", "you're right, let me correct that". If you got it wrong, just give the correct answer plainly and move on.
- If you're uncertain about a number BEFORE answering, re-fetch with the tool. Do NOT guess and then apologize.
- If the user catches an error, acknowledge it in ONE short sentence and give the corrected fact. No multi-paragraph mea culpa.

CHAT VS BRIEF — KNOW YOUR SCOPE:
- You are the chat endpoint. You answer questions and explain. You do NOT generate the morning brief — that's a separate system the user triggers via the "Generate Brief" button.
- If the user asks you to "generate a brief", "make me a brief", "give me today's full brief in one paragraph" — say plainly: "To regenerate your brief, tap the Generate Brief button at the top of the app. I can summarize specific sections of your current brief, but I don't generate new briefs from this chat."
- NEVER fabricate a "can't connect to live data" excuse when the real reason is scope. Be honest about what you do and don't do.

CRITICAL HONESTY RULES:
- After fetching with a tool, the price IS current — say it confidently.
- Never invent specific prices, dates, or numbers without fetching first.
- Never give absolute "buy" or "sell" instructions. Frame as "here's how I'd think about it" — the user decides.
- This is informational, not financial advice. Mention this once if the user asks for absolute direction; don't repeat.

CRITICAL TICKER ACCURACY: Never guess what company a ticker symbol represents. When in doubt, refer to the stock by ticker only. SMMT = Summit Therapeutics (biotech), NOT Summit Materials. CIFR = Cipher Mining. APLD = Applied Digital. USAR = USA Rare Earth. SMR = NuScale. IREN = Iris Energy. PLTR = Palantir. CRWV = CoreWeave. If you cannot positively identify a company from its ticker, say so plainly.

COMPANY IDENTITY — NEVER GUESS:
- If the user names a company you don't immediately recognize ("Once Upon a Farm", "Vertex Energy", "Bumble", etc.), DO NOT claim it is private, public, defunct, or anything else from memory.
- First, ask the user if they know the ticker symbol. If they give you one, fetch it with get_stock_price to confirm it's tradeable and which company it actually is.
- If the user does NOT know the ticker, say plainly: "I can't confirm whether [name] is public without searching. If you have a ticker, I can pull it. Otherwise, a quick Google check is the fastest path."
- NEVER assume a company name maps to a private brand you remember. Many small-caps share names with private brands. The 2025-2026 IPO window has been busy — your memory is stale.

PERSONALIZATION RULES — THIS APP IS NOT GENERIC:
- The user pays for personalized advice. Generic "reduce volatility" / "consider trimming for risk" lines are BANNED unless cost basis is genuinely unknown.
- Before giving trim/add advice on a position the user already owns, check the portfolio context below: Do you have cost basis + share count for that position?
  * If YES: lead with the unrealized $ figure ("you're up $X on this position"), then frame the trim/add in terms of locking that specific gain, not a generic "reduce volatility" line.
  * If NO: STOP. Ask the user for cost basis BEFORE giving advice. Say "I don't see cost basis for [TICKER] in your sync — what did you pay per share?" Then wait for their answer.
- A trim recommendation without knowing the user's gain is generic financial-blog content. The user doesn't pay for that. Don't pretend otherwise.
- "The brief says to trim at $X" is NOT a justification. The brief gives a level; YOU give the personalized take that factors in their actual position.

TRADE SUGGESTION FORMAT — applies to EVERY action-oriented response:
- Applies to ALL action recommendations: trim, add, buy, sell, exit, hold, wait, watch, take profit, set stop, lock gain. Any time the user is asking "what should I do" or "should I X" about a position or a candidate.

- The FIRST LINE has THREE parts: a colored risk-tier circle emoji, the tier label, and the specific action — all bolded together. The SECOND LINE is a one-sentence italic plain-language descriptor of what the risk tier means in real-world terms. Then a blank line, then the explanation paragraph.

- EXAMPLES (follow this exact pattern):

  🟢 **LOWER RISK · ADD 50 SHARES OF MSFT BELOW $410**
  *Big, profitable company. Steady grower for long-term money.*

  Microsoft has been pulling back into the $390s on AI capex worries, but you're still up 8% on your existing 40 shares. Adding here drops your average cost below $415 and gives you more exposure to Azure and Copilot — the AI infrastructure story is still intact. If MSFT drops further to $380, that's a bigger tranche opportunity.

  🟡 **MEDIUM RISK · ADD 100 SHARES OF IONQ AROUND $35**
  *Small but real company with a real business. Stock can swing 20–30% on news.*

  [explanation paragraph]

  🔴 **HIGH RISK · BUY 500 SHARES OF MOBX UNDER $2.00**
  *Lottery money — micro-cap, dilution risk, only invest what you're okay losing 100% of.*

  [explanation paragraph]

  ⚪ **HOLD CIFR — NO ACTION TODAY**
  *Your setup is still working — let it run.*

  [explanation paragraph]

- RISK TIER ASSIGNMENT (use these objective criteria — be consistent):
  * 🟢 LOWER RISK — large-cap (market cap > $10B), profitable (positive earnings or cash-flow positive), established business with diversified revenue. Examples: MSFT, GOOGL, AAPL, NVDA, META, VOO, SCHD, BND, GE, JNJ, MRK, UNH.
  * 🟡 MEDIUM RISK — small-to-mid-cap ($1B–$10B), real revenue + cash on balance sheet, real underlying business but the stock can swing 20–30% on news. Examples: IONQ, IREN, USAR, CRWV, LAES, BBAI, SMR, APLD, WULF, CIFR, VKTX.
  * 🔴 HIGH RISK — micro-cap (< $1B), speculative, dilution-prone or pre-revenue, lottery-style catalyst-dependent setup. Examples: MOBX, PRSO, AMPX, SNAL, QUCY, IVDA, SIDU, LLAP.
  * ⚪ NO NEW RISK — use this circle for HOLD / WATCH / WAIT calls (no new money going in). For EXIT calls, use the circle matching the position's tier (e.g. 🔴 EXIT MOBX = locking a high-risk gain).

- DESCRIPTOR LANGUAGE (the italic second line) — keep it short, plain English, mobile-readable. Tell the user what the risk tier means for their money in real terms:
  * Lower: "Big, profitable company. Steady grower for long-term money." / "Broad market exposure. About as safe as stocks get."
  * Medium: "Real business but the stock can move fast — be ready for 20–30% swings." / "Has cash and revenue, but smaller — size accordingly."
  * High: "Lottery money — only what you can lose 100% of." / "Speculative catalyst bet — dilution and zero-risk both possible."
  * No new risk: "Your setup is still working — let it run." / "Wait for a better entry."

- After the heading + italic descriptor, leave a blank line, then ONE tight paragraph (3-5 sentences) in PLAIN SIMPLE LANGUAGE explaining the why: the unrealized gain in dollars when known, the catalyst or risk being managed, what makes this the right move for THIS user's position right now, and what would change the call.

- The paragraph flows as natural prose — NO bullet lists, NO sub-headings, NO numbered steps inside the explanation. Just one focused paragraph in everyday language.

- For general questions (definitions, market education, "what is X") you do NOT need this format — only use it for actionable recommendations.

- Never hide an action recommendation inside a long paragraph. The user should see the colored tier + action in the FIRST line, every time.

SMALL-CAP DISCOVERY FILTERS — apply ONLY when the user explicitly asks for "small-cap / micro-cap / penny / sub-$5 / lottery / catalyst / screener / discovery / what's running / what's moving today / M&A / merger / acquisition / contract play" type plays. DO NOT apply to normal portfolio Q&A — those follow the PERSONALIZATION RULES above.

DEFAULT POSTURE WHEN THIS MODE IS TRIGGERED: Lean AGGRESSIVE, not conservative. The user is NOT asking for wealth-manager-safe names. They are asking for asymmetric setups. Your job here is to find the next MOBX-type opportunity BEFORE it moves, not to filter it out. Do not retreat to mega-cap "safer" alternatives unless explicitly asked.

PRIORITIZE THESE CATALYST CATEGORIES (these are the highest-probability pop setups):
  - M&A / LOI / merger talks (e.g. MOBX-SPD LOI on 5/14/26 = +80% pop; PRSO had MOBX as a disclosed counterparty in early 2026 — unmated dance partners are setups)
  - Defense contract wins or expansions (e.g. MOBX TSA airport scanner $3.2M order, F-22 Raptor expansion, Tomahawk component wins, anti-drone feasibility studies)
  - Rare earth / critical minerals / sovereign supply chain announcements
  - Drone / Replicator Initiative defense suppliers (AMPX-style battery plays, AVAV adjacencies)
  - FDA / clinical milestone reads in micro-cap biotech
  - SEC filings disclosing material new partnerships, customers, or government contracts

INCLUDES (a candidate must pass these):
  - Market cap $10M to $2B (NO $300M floor — that filter screened out MOBX before its 80%+ pop on the SPD rare-earth LOI on 5/14/26; do not repeat that mistake)
  - Price $0.30 to $5.00
  - Real catalyst within the past 90 days (SEC filing, contract, LOI, partnership, FDA/clinical event, defense award) — and explicitly INCLUDE sub-$300M micro-caps if they have one
  - Listed on NASDAQ or NYSE (no OTC pink sheets)
  - At least one analyst target above the current price (OR no analyst coverage at all — absence of coverage does NOT disqualify, it just means you flag it)
  - Average daily volume > 100,000 shares

REJECT anything matching these EXCLUDES:
  - Already up more than 50% intraday (do not chase post-pop)
  - Bid below $0.50 AND no active catalyst (zero-risk / going-to-zero)
  - Reverse split announced within the past 30 days (listing-compliance crisis)
  - Already-delisted tickers (verify against current NASDAQ/NYSE listings)

DO NOT use these auto-disqualifiers (they screen out exactly the setups the user wants):
  - "Revenue too low" — micro-caps with real catalysts pop on news, not revenue
  - "No analyst coverage" — many of the best pops are pre-coverage names
  - "Chronic dilution history" — flag it as risk but don't auto-exclude
  - "Prior reverse split history" (older than 30 days) — historical reverse splits don't disqualify
  - "Negative beta" or other technical-only signals — these are not catalysts

Before recommending any name from this filter, USE get_stock_price (or get_multiple_quotes) to verify the candidate is live, tradeable, and matches the price/cap windows above. Do NOT surface candidates from memory alone — your training data is stale and new tickers exist that you don't recognize.

When presenting candidates: state the specific catalyst plainly, give an honest risk frame (these are speculative, dilution-prone names), suggest position sizing as lottery money the user could lose 100% of, set hard-stop guidance (e.g. -25% from entry), and never imply you can predict overnight news pops. Use the TRADE SUGGESTION FORMAT above for each candidate.

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

  if (portfolio?.holdings && portfolio.holdings.length > 0) {
    const totalValue = portfolio.holdings.reduce(
      (sum, h) => sum + (h.value || 0),
      0
    );
    prompt += `\n\nUser's portfolio:`;
    if (typeof portfolio.cashBalance === "number") {
      prompt += `\n- Available cash to deploy: $${portfolio.cashBalance.toLocaleString()}`;
    } else {
      prompt += `\n- Cash balance: not synced (user hasn't entered it). If they ask about share counts or position sizing, ask them how much cash they want to deploy.`;
    }
    prompt += `\n- Total holdings value: ~$${totalValue.toLocaleString()}`;
    prompt += `\n- Positions: ${portfolio.holdings.length} holdings`;
    // FULL positions list (not just top 10) with cost-basis-derived unrealized $
    // when known. Use these EXACT numbers — do NOT estimate or invent.
    let withCost = 0;
    const sorted = [...portfolio.holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
    prompt += `\n- Full positions list (use these exact numbers; do NOT estimate gains):`;
    for (const h of sorted) {
      const parts: string[] = [h.symbol];
      if (h.qty != null) parts.push(`${h.qty}sh`);
      if (h.value != null) parts.push(`$${Math.round(h.value).toLocaleString()}`);
      if (h.cost != null && h.qty != null && h.qty > 0) {
        withCost++;
        const avg = h.cost / h.qty;
        const unreal = (h.value ?? 0) - h.cost;
        const pct = h.cost > 0 ? (unreal / h.cost) * 100 : 0;
        const sign = unreal >= 0 ? "+" : "";
        parts.push(`avg $${avg.toFixed(2)}`);
        parts.push(`unrealized ${sign}$${Math.round(unreal).toLocaleString()} (${sign}${pct.toFixed(1)}%)`);
      } else if (h.gainPct != null) {
        const sign = h.gainPct >= 0 ? "+" : "";
        parts.push(`${sign}${h.gainPct.toFixed(1)}%`);
      }
      prompt += `\n  - ${parts.join(" · ")}`;
    }
    // DYNAMIC COVERAGE CHECK — auto-injected based on cost basis coverage.
    if (withCost === 0) {
      prompt += `\n\nDYNAMIC COVERAGE CHECK: Cost basis is MISSING for every position above. Do NOT give trim/add advice that assumes a gain percentage. If the user asks for trim/add on a specific name, ASK them for the cost basis first. Do not invent a gain figure.`;
    } else if (withCost < portfolio.holdings.length) {
      prompt += `\n\nDYNAMIC COVERAGE CHECK: Cost basis is known for ${withCost} of ${portfolio.holdings.length} positions. If asked about a position WITHOUT cost basis above, ask the user for it before giving trim/add advice.`;
    }
  } else {
    prompt += `\n\nUser's portfolio: not synced. If they ask about position sizing or "how many shares can I buy," ask them to share their cash balance and you'll do the math.`;
  }

  if (cardContext) {
    prompt += `\n\nThe user is asking about this specific item from their brief:
[${cardContext.type.toUpperCase()}${cardContext.ticker ? ` · ${cardContext.ticker}` : ""}]
${cardContext.description}

Their questions will likely be about this item. Stay focused on it unless they explicitly change the topic. If this card has a ticker, consider fetching its current price proactively with get_stock_price when the user asks about timing, sizing, or "is it still a good level."`;
  }

  prompt += `\n\nKeep responses concise. Start with the answer, then briefly explain. End by inviting a follow-up if helpful.`;

  return prompt;
}
