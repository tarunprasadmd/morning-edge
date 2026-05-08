// /api/prices — live quote endpoint. Uses yahoo-finance2 npm library.
//
// Request:  /api/prices?symbols=NVDA,MSFT,AAPL    (comma-separated)
// Response: {
//   prices: { "NVDA": { price: 875.30, changePct: 2.45, prevClose: 854.20 }, ... },
//   fetchedAt: "2026-05-07T13:30:00.000Z",
//   errors?: ["BADSYM: not found"]
// }

import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

interface QuoteResult {
  price: number | null;
  changePct: number | null;
  prevClose: number | null;
}

const cache = new Map<string, { data: QuoteResult; expiresAt: number }>();
const CACHE_MS = 30_000;
const MAX_SYMBOLS = 60;

async function fetchOne(symbol: string): Promise<QuoteResult> {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.data;

  // Cast to any to avoid TS friction with yahoo-finance2's strict types.
  const q: any = await (yahooFinance as any).quote(symbol);
  const price =
    typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null;
  const prevClose =
    typeof q?.regularMarketPreviousClose === "number"
      ? q.regularMarketPreviousClose
      : null;
  let changePct: number | null = null;
  if (typeof q?.regularMarketChangePercent === "number") {
    changePct = q.regularMarketChangePercent;
  } else if (price != null && prevClose != null && prevClose !== 0) {
    changePct = ((price - prevClose) / prevClose) * 100;
  }

  const result: QuoteResult = { price, changePct, prevClose };
  cache.set(symbol, { data: result, expiresAt: now + CACHE_MS });
  return result;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = (url.searchParams.get("symbols") || "").trim();
    if (!raw) {
      return NextResponse.json(
        { prices: {}, fetchedAt: new Date().toISOString(), error: "missing symbols query param" },
        { status: 400 }
      );
    }

    const symbols = Array.from(
      new Set(
        raw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
      )
    ).slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      return NextResponse.json(
        { prices: {}, fetchedAt: new Date().toISOString(), error: "no valid symbols provided" },
        { status: 400 }
      );
    }

    const errors: string[] = [];
    const settled = await Promise.allSettled(symbols.map((s) => fetchOne(s)));
    const prices: Record<string, QuoteResult> = {};
    settled.forEach((r, i) => {
      const sym = symbols[i];
      if (r.status === "fulfilled") {
        prices[sym] = r.value;
      } else {
        errors.push(`${sym}: ${r.reason?.message || "fetch failed"}`);
      }
    });

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
      ...(errors.length > 0 ? { errors } : {}),
    });
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
