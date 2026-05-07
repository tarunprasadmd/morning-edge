// /api/prices — live quote endpoint for the ticker tape and any other
// component that needs current prices.
//
// Uses Yahoo Finance's public chart endpoint directly via fetch — no API key
// required, no npm package to install. Yahoo's endpoint is informally public
// and used widely by indie projects; if it ever breaks, we fall back to
// returning empty prices and the UI gracefully shows the static placeholders.
//
// Response shape:
//   {
//     prices: {
//       "NVDA": { price: 875.30, changePct: 2.45, prevClose: 854.20 },
//       "MSFT": { ... },
//       ...
//     },
//     fetchedAt: "2026-05-07T13:30:00Z",
//     errors: ["AAPL: timeout"]   // optional, when some symbols fail
//   }
//
// Frontend polls this every 60s while the app is foregrounded. Cache is
// 30s in-process so back-to-back polls from the same worker don't all hit
// Yahoo. (Vercel serverless workers don't share memory across cold starts,
// so this is best-effort.)

import { NextResponse } from "next/server";

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

// Yahoo's chart endpoint returns price + previous close. We use chart instead
// of the v7/quote endpoint because v7/quote requires a session cookie/crumb
// that's a hassle to maintain. The chart endpoint is more permissive.
async function fetchYahooQuote(symbol: string): Promise<QuoteResult> {
  const cached = cache.get(symbol);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
      // Yahoo can hang sometimes; bail after 4s rather than holding the worker
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const j: any = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error("no result");
    const meta = result.meta || {};
    const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
    const prevClose =
      typeof meta.chartPreviousClose === "number"
        ? meta.chartPreviousClose
        : typeof meta.previousClose === "number"
        ? meta.previousClose
        : null;
    const changePct =
      price != null && prevClose != null && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : null;
    const data: QuoteResult = { price, changePct, prevClose };
    cache.set(symbol, { data, expiresAt: now + CACHE_MS });
    return data;
  } catch (err: any) {
    // Don't cache failures — try again next poll.
    return { price: null, changePct: null, prevClose: null };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") || "";
    const symbols = symbolsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
      .slice(0, 30); // safety cap — UI rarely shows more than ~20

    if (symbols.length === 0) {
      return NextResponse.json({ prices: {}, fetchedAt: new Date().toISOString() });
    }

    const results = await Promise.allSettled(
      symbols.map(async (sym) => ({ sym, data: await fetchYahooQuote(sym) }))
    );

    const prices: Record<string, QuoteResult> = {};
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        prices[r.value.sym] = r.value.data;
        if (r.value.data.price == null) errors.push(`${r.value.sym}: no data`);
      } else {
        errors.push(`unknown: ${r.reason}`);
      }
    }

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err: any) {
    // Total failure — return empty so UI doesn't crash
    return NextResponse.json(
      { prices: {}, fetchedAt: new Date().toISOString(), error: err?.message || "unknown" },
      { status: 200 } // 200 with empty prices is friendlier than 500
    );
  }
}
