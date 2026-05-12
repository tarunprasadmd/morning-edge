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
import yahooFinance from "yahoo-finance2";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    // Up to 5 rounds. Each round: call Claude; if it returns tool_use
    // blocks, execute them and append tool_result blocks; loop.
    // Otherwise, extract final text and return.
    const MAX_ROUNDS = 5;
    let conversation: any[] = [...trimmedMessages];
    let finalText = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usedTools: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await callWithRetry(() =>
        anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 1200,
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

  let prompt = `You are Morning Edge, an AI investing copilot built into the user's daily brief app. You help the user think through specific recommendations from their brief — by giving direct, useful, personalized analysis.

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

CRITICAL HONESTY RULES:
- After fetching with a tool, the price IS current — say it confidently.
- Never invent specific prices, dates, or numbers without fetching first.
- Never give absolute "buy" or "sell" instructions. Frame as "here's how I'd think about it" — the user decides.
- This is informational, not financial advice. Mention this once if the user asks for absolute direction; don't repeat.

CRITICAL TICKER ACCURACY: Never guess what company a ticker symbol represents. When in doubt, refer to the stock by ticker only. SMMT = Summit Therapeutics (biotech), NOT Summit Materials. CIFR = Cipher Mining. APLD = Applied Digital. USAR = USA Rare Earth. SMR = NuScale. IREN = Iris Energy. PLTR = Palantir. CRWV = CoreWeave. If you cannot positively identify a company from its ticker, say so plainly.

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
    prompt += `\n- Top positions:`;
    const topByValue = [...portfolio.holdings]
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 10);
    for (const h of topByValue) {
      const valStr = h.value ? `$${h.value.toLocaleString()}` : "(value unknown)";
      const qtyStr = h.qty ? `${h.qty} sh` : "";
      const gainStr =
        h.gainPct != null ? ` (${h.gainPct > 0 ? "+" : ""}${h.gainPct.toFixed(1)}%)` : "";
      prompt += `\n  - ${h.symbol} — ${qtyStr} ${valStr}${gainStr}`;
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
