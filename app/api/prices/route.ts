// /api/prices — live quote endpoint. Powered by yahoo-finance2 (free, no key).
//
// Supports both GET and POST:
//   GET  /api/prices?symbols=NVDA,MSFT,AAPL
//   POST /api/prices  body: { "symbols": ["NVDA","MSFT","AAPL"] }
//
// Response:
// {
//   prices: {
//     "NVDA": { price: 875.30, change: 21.10, changePct: 2.45, prevClose: 854.20 },
//     ...
//   },
//   fetchedAt: "2026-05-08T13:30:00.000Z",
//   errors?: ["BADSYM: not found"]
// }
//
// 30s in-memory cache prevents back-to-back polls from hammering Yahoo
// when the same warm worker is reused.

import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

// yahoo-finance2 v3 requires instantiation (changed from v2 singleton)
const yahooFinance: any = new (YahooFinance as any)();

interface QuoteResult {
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
}

const cache = new Map<string, { data: QuoteResult; expiresAt: number }>();
const CACHE_MS = 30_000;
const MAX_SYMBOLS = 60;

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

async function fetchOne(symbol: string): Promise<QuoteResult> {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.data;

  // Cast to any — yahoo-finance2's strict types fight Next.js TS in production.
  const q: any = await (yahooFinance as any).quote(symbol);
  const price =
    typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null;
  const prevClose =
    typeof q?.regularMarketPreviousClose === "number"
      ? q.regularMarketPreviousClose
      : null;

  let change: number | null = null;
  if (typeof q?.regularMarketChange === "number") {
    change = q.regularMarketChange;
  } else if (price != null && prevClose != null) {
    change = price - prevClose;
  }

  let changePct: number | null = null;
  if (typeof q?.regularMarketChangePercent === "number") {
    changePct = q.regularMarketChangePercent;
  } else if (price != null && prevClose != null && prevClose !== 0) {
    changePct = ((price - prevClose) / prevClose) * 100;
  }

  const result: QuoteResult = { price, change, changePct, prevClose };
  cache.set(symbol, { data: result, expiresAt: now + CACHE_MS });
  return result;
}

function normalizeSymbols(rawList: string[]): string[] {
  return Array.from(
    new Set(
      rawList
        .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
        .filter((s) => SYMBOL_RE.test(s))
    )
  ).slice(0, MAX_SYMBOLS);
}

async function buildResponse(symbols: string[]) {
  const errors: string[] = [];
  const now = Date.now();

  // Partition into cached vs uncached. Cached entries return instantly from the
  // in-memory 30s cache; only uncached symbols hit Yahoo. After a warm worker
  // has 45 tickers cached, a repeat call is microseconds.
  const cachedPrices: Record<string, QuoteResult> = {};
  const symbolsToFetch: string[] = [];
  for (const sym of symbols) {
    const c = cache.get(sym);
    if (c && c.expiresAt > now) {
      cachedPrices[sym] = c.data;
    } else {
      symbolsToFetch.push(sym);
    }
  }

  let prices: Record<string, QuoteResult> = { ...cachedPrices };

  if (symbolsToFetch.length > 0) {
    try {
      // SINGLE BULK REQUEST — one HTTP call to Yahoo for all uncached tickers.
      // yahoo-finance2's quote() accepts an array and returns array of results.
      // Replaces the previous 45-parallel-request fan-out which Yahoo throttled.
      const bulk: any[] = await (yahooFinance as any).quote(symbolsToFetch);
      const list: any[] = Array.isArray(bulk) ? bulk : [bulk];

      // Build a lookup keyed by symbol so we can map results back regardless
      // of order Yahoo returned them in.
      const bySymbol: Record<string, any> = {};
      for (const q of list) {
        if (q && typeof q.symbol === "string") {
          bySymbol[q.symbol.toUpperCase()] = q;
        }
      }

      for (const sym of symbolsToFetch) {
        const q = bySymbol[sym];
        if (!q) {
          errors.push(`${sym}: not returned by Yahoo`);
          continue;
        }
        const price = typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null;
        const prevClose = typeof q?.regularMarketPreviousClose === "number" ? q.regularMarketPreviousClose : null;
        let change: number | null = null;
        if (typeof q?.regularMarketChange === "number") {
          change = q.regularMarketChange;
        } else if (price != null && prevClose != null) {
          change = price - prevClose;
        }
        let changePct: number | null = null;
        if (typeof q?.regularMarketChangePercent === "number") {
          changePct = q.regularMarketChangePercent;
        } else if (price != null && prevClose != null && prevClose !== 0) {
          changePct = ((price - prevClose) / prevClose) * 100;
        }
        const result: QuoteResult = { price, change, changePct, prevClose };
        cache.set(sym, { data: result, expiresAt: now + CACHE_MS });
        prices[sym] = result;
      }
    } catch (bulkErr: any) {
      // Fallback to per-symbol fetch with Promise.allSettled if bulk fails.
      // This preserves correctness if Yahoo's bulk endpoint goes flaky.
      const settled = await Promise.allSettled(symbolsToFetch.map((s) => fetchOne(s)));
      settled.forEach((r, i) => {
        const sym = symbolsToFetch[i];
        if (r.status === "fulfilled") {
          prices[sym] = r.value;
        } else {
          errors.push(`${sym}: ${r.reason?.message || "fetch failed"}`);
        }
      });
    }
  }

  return {
    prices,
    fetchedAt: new Date().toISOString(),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = (url.searchParams.get("symbols") || "").trim();
    if (!raw) {
      return NextResponse.json(
        {
          prices: {},
          fetchedAt: new Date().toISOString(),
          error: "missing symbols query param",
        },
        { status: 400 }
      );
    }
    const symbols = normalizeSymbols(raw.split(","));
    if (symbols.length === 0) {
      return NextResponse.json(
        {
          prices: {},
          fetchedAt: new Date().toISOString(),
          error: "no valid symbols provided",
        },
        { status: 400 }
      );
    }
    const data = await buildResponse(symbols);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      {
        prices: {},
        fetchedAt: new Date().toISOString(),
        error: err?.message || "unknown",
      },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawList: any = body?.symbols;
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return NextResponse.json(
        {
          prices: {},
          fetchedAt: new Date().toISOString(),
          error: "missing or invalid 'symbols' array in body",
        },
        { status: 400 }
      );
    }
    const symbols = normalizeSymbols(rawList);
    if (symbols.length === 0) {
      return NextResponse.json(
        {
          prices: {},
          fetchedAt: new Date().toISOString(),
          error: "no valid symbols provided",
        },
        { status: 400 }
      );
    }
    const data = await buildResponse(symbols);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      {
        prices: {},
        fetchedAt: new Date().toISOString(),
        error: err?.message || "unknown",
      },
      { status: 200 }
    );
  }
}
