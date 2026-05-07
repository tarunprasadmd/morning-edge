// /api/prices/history — historical price candles for the chart on each
// stock card's reading page.
//
// Supports 5 standard timeframes:
//   1d  — intraday, 5-minute candles  (about 78 points during a trading day)
//   1w  — 5 trading days, 30-minute candles
//   1m  — ~22 daily candles
//   1y  — ~252 daily candles
//   5y  — weekly candles, ~260 points
//
// Uses Yahoo Finance's public chart endpoint via fetch. Same approach as
// /api/prices — no API key, graceful degradation on failure.
//
// Response:
//   {
//     symbol: "NVDA",
//     period: "1m",
//     points: [{ t: 1746547200000, c: 875.30 }, ...],   // unix-ms timestamps
//     meta: { firstClose: 854.20, lastClose: 875.30, changePct: 2.47 }
//   }

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

interface HistoryPoint {
  t: number;
  c: number;
}

// Map our period names to Yahoo's range + interval combinations.
const PERIOD_MAP: Record<string, { range: string; interval: string; cacheMs: number }> = {
  "1d": { range: "1d", interval: "5m", cacheMs: 60_000 },
  "1w": { range: "5d", interval: "30m", cacheMs: 5 * 60_000 },
  "1m": { range: "1mo", interval: "1d", cacheMs: 60 * 60_000 },
  "1y": { range: "1y", interval: "1d", cacheMs: 60 * 60_000 },
  "5y": { range: "5y", interval: "1wk", cacheMs: 6 * 60 * 60_000 },
};

const cache = new Map<string, { data: any; expiresAt: number }>();

async function fetchYahooHistory(symbol: string, period: string) {
  const cfg = PERIOD_MAP[period];
  if (!cfg) throw new Error(`bad period: ${period}`);
  const key = `${symbol}:${period}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg.interval}&range=${cfg.range}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const j: any = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("no result");

  const timestamps: number[] = result.timestamp || [];
  const closeRaw: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

  // Filter out null closes (gaps in Yahoo data — happens at session edges)
  const points: HistoryPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const c = closeRaw[i];
    if (typeof t === "number" && typeof c === "number" && !Number.isNaN(c)) {
      points.push({ t: t * 1000, c });
    }
  }

  if (points.length === 0) throw new Error("empty series");

  const firstClose = points[0].c;
  const lastClose = points[points.length - 1].c;
  const changePct = firstClose !== 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const data = {
    symbol,
    period,
    points,
    meta: { firstClose, lastClose, changePct },
  };

  cache.set(key, { data, expiresAt: now + cfg.cacheMs });
  return data;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    const period = (url.searchParams.get("period") || "1m").trim().toLowerCase();

    if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      return NextResponse.json(
        { error: "missing or invalid symbol" },
        { status: 400 }
      );
    }
    if (!PERIOD_MAP[period]) {
      return NextResponse.json(
        { error: `invalid period; expected one of ${Object.keys(PERIOD_MAP).join(", ")}` },
        { status: 400 }
      );
    }

    const data = await fetchYahooHistory(symbol, period);
    return NextResponse.json(data);
  } catch (err: any) {
    // Return 200 with empty payload — frontend handles "no data" gracefully
    return NextResponse.json(
      {
        symbol: "",
        period: "",
        points: [],
        meta: { firstClose: 0, lastClose: 0, changePct: 0 },
        error: err?.message || "unknown",
      },
      { status: 200 }
    );
  }
}
