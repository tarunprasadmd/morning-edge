// /api/prices/history — historical price candles for charts.
// Uses yahoo-finance2 npm library to bypass Yahoo's bot detection.
//
// Request:  /api/prices/history?symbol=NVDA&period=1m
// Response: { symbol, period, points: [{t, c}, ...], meta: { firstClose, lastClose, changePct } }
//
// On any failure → returns 200 with empty points + error string. Frontend
// renders a polite "Chart data unavailable" message gracefully.

import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

// yahoo-finance2 v3 requires instantiation (changed from v2 singleton)
const yahooFinance: any = new (YahooFinance as any)();

interface HistoryPoint {
  t: number; // unix-ms timestamp
  c: number; // close price
}

interface PeriodConfig {
  range: string;
  interval: string;
  cacheMs: number;
}

const PERIOD_MAP: Record<string, PeriodConfig> = {
  "1d": { range: "1d", interval: "5m", cacheMs: 60_000 },
  "1w": { range: "5d", interval: "30m", cacheMs: 5 * 60_000 },
  "1m": { range: "1mo", interval: "1d", cacheMs: 60 * 60_000 },
  "1y": { range: "1y", interval: "1d", cacheMs: 60 * 60_000 },
  "5y": { range: "5y", interval: "1wk", cacheMs: 6 * 60 * 60_000 },
};

const cache = new Map<string, { data: any; expiresAt: number }>();

async function fetchHistory(symbol: string, period: string) {
  const cfg = PERIOD_MAP[period];
  if (!cfg) throw new Error(`bad period: ${period}`);

  const key = `${symbol}:${period}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  // yahoo-finance2 chart() returns { meta, quotes: [{date, open, high, low, close, volume}, ...] }
  // Cast to any to avoid TS friction with the library's strict types.
  const result: any = await (yahooFinance as any).chart(symbol, {
    range: cfg.range,
    interval: cfg.interval,
    includePrePost: false,
  });

  const quotes: any[] = result?.quotes || [];
  const points: HistoryPoint[] = [];
  for (const q of quotes) {
    if (!q || q.close == null || !q.date) continue;
    const close = Number(q.close);
    const ts = q.date instanceof Date ? q.date.getTime() : new Date(q.date).getTime();
    if (Number.isFinite(close) && Number.isFinite(ts)) {
      points.push({ t: ts, c: close });
    }
  }

  if (points.length < 2) throw new Error("empty series");

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
        { symbol: "", period: "", points: [], meta: null, error: "missing or invalid symbol" },
        { status: 400 }
      );
    }
    if (!PERIOD_MAP[period]) {
      return NextResponse.json(
        {
          symbol: "",
          period: "",
          points: [],
          meta: null,
          error: `invalid period; expected one of ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const data = await fetchHistory(symbol, period);
    return NextResponse.json(data);
  } catch (err: any) {
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
