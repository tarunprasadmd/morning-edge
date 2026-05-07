// /api/prices/history — historical price candles for the StockChart in
// the reading page. Uses the yahoo-finance2 npm library which handles
// Yahoo's cookie/crumb authentication automatically — direct fetch to
// query1.finance.yahoo.com no longer works reliably as of 2024.
//
// Request:  /api/prices/history?symbol=NVDA&period=1m
// Response: { symbol, period, points: [{t, c}, ...], meta: { firstClose, lastClose, changePct } }
//
// On any failure → returns 200 with empty points + error string. The
// frontend renders "Chart data unavailable for this symbol" gracefully.

import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

// Quiet down yahoo-finance2's startup notices in serverless logs.
yahooFinance.suppressNotices(["yahooSurvey"]);

interface HistoryPoint {
  t: number; // unix-ms timestamp
  c: number; // close price
}

interface PeriodConfig {
  range: string;    // yahoo-finance2 range string
  interval: string; // candle granularity
  cacheMs: number;  // how long to keep response in memory
}

// Map our friendly period names to yahoo-finance2 chart() params.
// Wider windows get longer cache TTLs because the data barely changes.
const PERIOD_MAP: Record<string, PeriodConfig> = {
  "1d": { range: "1d",  interval: "5m",  cacheMs: 60_000 },         // 1 min
  "1w": { range: "5d",  interval: "30m", cacheMs: 5  * 60_000 },    // 5 min
  "1m": { range: "1mo", interval: "1d",  cacheMs: 60 * 60_000 },    // 1 hour
  "1y": { range: "1y",  interval: "1d",  cacheMs: 60 * 60_000 },    // 1 hour
  "5y": { range: "5y",  interval: "1wk", cacheMs: 6 * 60 * 60_000 }, // 6 hours
};

// In-memory cache. Vercel reuses warm workers for a few minutes so this
// helps for back-to-back taps on the same chart. A KV-backed cache would
// help across cold starts too, but this is sufficient for now.
const cache = new Map<string, { data: any; expiresAt: number }>();

async function fetchHistory(symbol: string, period: string) {
  const cfg = PERIOD_MAP[period];
  if (!cfg) throw new Error(`bad period: ${period}`);

  const key = `${symbol}:${period}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  // yahoo-finance2 chart() returns { meta, quotes: [{date, open, high, low, close, volume}, ...] }
  const result = await yahooFinance.chart(symbol, {
    range: cfg.range as any,
    interval: cfg.interval as any,
    includePrePost: false,
  });

  const quotes = result?.quotes || [];
  const points: HistoryPoint[] = [];
  for (const q of quotes) {
    if (!q || q.close == null || !q.date) continue;
    const close = Number(q.close);
    const ts = q.date instanceof Date ? q.date.getTime() : new Date(q.date as any).getTime();
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

    const data = await fetchHistory(symbol, period);
    return NextResponse.json(data);
  } catch (err: any) {
    // 200 with empty payload — frontend treats as "no data" and renders the
    // friendly message. Avoid throwing so the reading page doesn't break.
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
