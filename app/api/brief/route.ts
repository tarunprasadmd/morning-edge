import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── In-memory brief cache (4-hour TTL) ────────────────────────────────
// Caches the generated brief keyed by a hash of (name + watchlist + holdings
// fingerprint + 4-hour time bucket). The same user reloading within the
// same 4-hour window gets an instant response. Vercel warm instances retain
// this cache; cold starts regenerate, which is acceptable.
//
// Bypass with ?fresh=1 (or { forceFresh: true } in body). The user's
// pull-to-refresh action triggers ?fresh=1 on the client, so manual refresh
// always gets fresh content.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const briefCache = new Map<string, { brief: any; storedAt: number }>();

function buildCacheKey(input: {
  name: string;
  watchlist: string[];
  holdings: any[];
  date: string;
}) {
  // 4-hour bucket so the key naturally rolls every 4 hours
  const bucket = Math.floor(Date.now() / CACHE_TTL_MS);
  // Holdings fingerprint: just the symbols + share counts, sorted
  const holdingsFingerprint = (input.holdings || [])
    .map((h: any) => `${h.symbol}:${h.qty ?? ""}:${h.accountId ?? ""}`)
    .sort()
    .join(",");
  const watchFingerprint = (input.watchlist || []).slice().sort().join(",");
  const raw = JSON.stringify({
    n: input.name || "",
    w: watchFingerprint,
    h: holdingsFingerprint,
    d: input.date || "",
    b: bucket,
  });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const queryFresh = url.searchParams.get("fresh") === "1";
    const isStream = url.searchParams.get("stream") === "1";
    const body = await request.json();
    const { name, watchlist, holdings, accounts, holdingsAgeDays, date, forceFresh } = body;
    const fresh = queryFresh || !!forceFresh;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const cacheKey = buildCacheKey({ name, watchlist, holdings, date });

    // ─── STREAMING PATH ─────────────────────────────────────────────────
    // Generate the brief in parallel chunks and stream each card to the
    // client as it completes. Total wall time = slowest single chunk.
    if (isStream) {
      // Cache short-circuit: if we have a fresh cached brief, replay it as
      // a stream so the client code path is identical.
      if (!fresh) {
        const hit = briefCache.get(cacheKey);
        if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
          return new Response(
            new ReadableStream({
              start(controller) {
                const enc = new TextEncoder();
                const send = (event: string, data: any) => {
                  controller.enqueue(
                    enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                  );
                };
                send("meta", { cached: true });
                for (const [key, value] of Object.entries(hit.brief)) {
                  send("card", { key, value });
                }
                send("done", {});
                controller.close();
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
              },
            }
          );
        }
      }

      // Live streaming generation. Each chunk is its own Anthropic call,
      // started concurrently. As each resolves, we push a card event to
      // the client. Failures are isolated to that chunk — other cards
      // still arrive.
      return new Response(
        new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (event: string, data: any) => {
              try {
                controller.enqueue(
                  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
              } catch (_e) {
                /* client disconnected */
              }
            };

            send("meta", { cached: false, fresh });

            const accumulated: Record<string, any> = {};
            const acc = (key: string, value: any) => {
              accumulated[key] = value;
              send("card", { key, value });
            };

            // Wrap a chunk generator: run it, parse JSON, send each
            // resulting card. Errors are logged but don't bubble up.
            const runChunk = async (
              label: string,
              chunkPromise: Promise<Record<string, any> | null>
            ) => {
              try {
                const result = await chunkPromise;
                if (result) {
                  for (const [k, v] of Object.entries(result)) {
                    acc(k, v);
                  }
                }
              } catch (err: any) {
                console.error(`Chunk ${label} failed:`, err?.message || err);
              }
            };

            const tasks = [
              runChunk("inspiration", chunkInspiration(name, date)),
              runChunk("market_pulse", chunkMarketPulse(name, watchlist, date)),
              runChunk("smart_money", chunkSmartMoney(name, watchlist, holdings, date)),
              runChunk("todays_edge", chunkTodaysEdgeAndRadar(name, watchlist, holdings, date)),
              runChunk("conviction_watch", chunkConvictionWatch(name, watchlist, holdings, holdingsAgeDays, date)),
              runChunk("decisions", chunkDecisions(name, watchlist, holdings, accounts, holdingsAgeDays, date)),
            ];

            await Promise.allSettled(tasks);

            // Persist the assembled brief so the next plain-JSON GET hits
            // can use the cache too.
            if (Object.keys(accumulated).length > 0) {
              briefCache.set(cacheKey, { brief: accumulated, storedAt: Date.now() });
              // Light cleanup
              if (briefCache.size > 100) {
                const now = Date.now();
                for (const [k, v] of briefCache.entries()) {
                  if (now - v.storedAt > CACHE_TTL_MS) briefCache.delete(k);
                }
              }
            }

            send("done", { cardCount: Object.keys(accumulated).length });
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        }
      );
    }

    // ─── NON-STREAMING FALLBACK (legacy single call) ───────────────────
    if (!fresh) {
      const hit = briefCache.get(cacheKey);
      if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
        return NextResponse.json({ brief: hit.brief, cached: true });
      }
    }

    const userPrompt = buildPrompt(name, watchlist, holdings, accounts, holdingsAgeDays, date);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 6,
        } as any,
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    // Web search returns multiple content blocks — collect all text blocks
    const textBlocks = response.content.filter((b) => b.type === "text");
    const rawText = textBlocks.map((b: any) => b.text || "").join("\n");

    const cleaned = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json(
        { error: "Model returned no JSON object", raw: rawText },
        { status: 502 }
      );
    }

    let brief;
    try {
      brief = JSON.parse(cleaned.slice(start, end + 1));
    } catch (parseErr) {
      return NextResponse.json(
        { error: "Model returned invalid JSON", raw: rawText },
        { status: 502 }
      );
    }

    // Store in cache
    briefCache.set(cacheKey, { brief, storedAt: Date.now() });
    // Light cleanup: prune entries older than TTL when cache grows large
    if (briefCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of briefCache.entries()) {
        if (now - v.storedAt > CACHE_TTL_MS) briefCache.delete(k);
      }
    }

    return NextResponse.json({ brief, cached: false });
  } catch (err: any) {
    console.error("Brief generation failed:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}

// ─── Chunk generators (streaming path) ─────────────────────────────────
// Each chunk is a focused Anthropic call that returns ONE OR MORE keys
// of the brief. Running them concurrently turns a 30s sequential brief
// into a ~10s parallel brief, with cards rendering as soon as each
// chunk lands on the client.
//
// Each generator returns an object whose keys map directly into the
// `brief` shape — e.g. { affirmation: "...", mindset: {...} }.
// Failures return null so other chunks can still ship.

const COMMON_PREAMBLE = (name: string, date: string) =>
  `You are a JSON generator. Output ONLY a single valid JSON object — no prose, no markdown, no code fences. Start with { and end with }.

Generate part of a morning briefing for ${name || "the user"} on ${date}. The reader is a sophisticated multi-account swing trader who knows technical analysis, smart-money signals (13F, STOCK Act, Form 4s), and macro catalysts. No beginner advice. No filler. They invest in: AI infrastructure, semiconductors, quantum, crypto-mining-to-HPC pivots, nuclear energy, rare earths, and speculative biotech (GLP-1, oncology).
`;

async function callJsonChunk(prompt: string, opts: { search?: boolean; maxTokens?: number } = {}) {
  const { search = false, maxTokens = 2000 } = opts;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: maxTokens,
    ...(search
      ? {
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 3,
            } as any,
          ],
        }
      : {}),
    messages: [{ role: "user", content: prompt }],
  });
  const textBlocks = response.content.filter((b: any) => b.type === "text");
  const rawText = textBlocks.map((b: any) => b.text || "").join("\n");
  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model returned no JSON object");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function chunkInspiration(name: string, date: string) {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Generate the morning inspiration block. Return:

{
  "affirmation": "short sharp opening line, max 12 words",
  "mindset": {
    "gratitude": "stimulating affirmation in one of three rotating voices (Stoic warrior / Quiet power / Athlete mindset), max 18 words. Vary by day.",
    "fuel": "10-min vitality cue, e.g. '2 min mobility · 3 min breathwork · 3 min strength · 2 min stretch.'",
    "focus": "concrete breath/mental cue, max 10 words"
  },
  "clarity": {
    "contemplation": "ONE present-tense sentence to sit with for 60 seconds, max 22 words, in the user's voice",
    "eastern_wisdom": { "quote": "real attributed quote from Lao Tzu / Rumi / Thich Nhat Hanh / Marcus Aurelius / Buddha / Vedanta / Zen, max 30 words", "source": "attribution" },
    "breath_practice": { "name": "Box / Coherent / 4-7-8 / Bhramari / Nadi Shodhana / Physiological Sigh / Ujjayi", "pattern": "timing pattern in plain text", "description": "physiological effect, max 24 words", "rounds": "rounds or duration" }
  },
  "power_plate": {
    "name": "recipe name, max 6 words",
    "style": "High Protein or Mediterranean or Anti-Inflammatory",
    "protein_g": 30,
    "prep_min": 25,
    "description": "1-2 sentences, max 28 words",
    "groceries": ["4-6 grocery line items"],
    "prep_steps": ["4-5 short cooking steps, max 18 words each"]
  }
}`;
  return callJsonChunk(prompt, { maxTokens: 1500 });
}

async function chunkMarketPulse(name: string, watchlist: string[], date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, and macro events. Watchlist: ${tickers}.

Return ONLY:
{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each — index futures, VIX, key commodities, sector rotation, today's catalysts"]
  }
}`;
  return callJsonChunk(prompt, { search: true, maxTokens: 1200 });
}

async function chunkSmartMoney(name: string, watchlist: string[], holdings: any[], date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch the LATEST 13F disclosures, biggest insider Form 4 trades from the past 1-2 weeks, and most recent congressional STOCK Act filings.${ownedNote}

Return ONLY:
{
  "smart_money": {
    "summary": {
      "most_bought": ["TICKER1", "TICKER2"],
      "most_sold": ["TICKER1", "TICKER2"],
      "net_bullish_sectors": ["2-3 sector names"],
      "net_bearish_sectors": ["1-2 sector names"]
    },
    "sector_heatmap": [
      { "sector": "sector name max 22 chars", "direction": "buying or selling or neutral", "intensity": 1 }
    ],
    "whale_moves": [ { "text": "named trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ],
    "congress_moves": [ { "text": "named congressional trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ],
    "hedge_fund_moves": [ { "text": "named hedge fund trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ]
  }
}`;
  return callJsonChunk(prompt, { search: true, maxTokens: 2000 });
}

async function chunkTodaysEdgeAndRadar(name: string, watchlist: string[], holdings: any[], date: string) {
  const ownedNote = (holdings || []).length > 0
    ? `\nUser's holdings: ${(holdings as any[]).map((h: any) => `${h.symbol}${h.qty != null ? ` ${h.qty}sh` : ""}`).join(", ")}.`
    : `\nNo holdings on file. Use the watchlist: ${(watchlist && watchlist.length) ? watchlist.join(", ") : "general market"}.`;
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const radarExclusion = ownedSet.size > 0
    ? `\nFor radar_watch: EXCLUDE any tickers the user already owns (${Array.from(ownedSet).join(", ")}).`
    : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch earnings dates, ex-dividend dates, FDA decisions, and known catalysts in the next 1-2 weeks.${ownedNote}${radarExclusion}

Return ONLY:
{
  "todays_edge": {
    "earnings_alerts": [ { "ticker": "TICKER", "when": "today after close" | "tomorrow before open", "your_shares": 0 } ],
    "binary_catalysts": [ { "ticker": "TICKER", "event": "event date", "context": "max 12 words" } ],
    "risk_flags": [ { "ticker": "TICKER", "flag": "max 12 words", "suggested_action": "max 12 words" } ]
  },
  "radar_watch": [
    { "ticker": "TICKER", "theme": "short tag e.g. 'Nuclear · AI energy'", "headline": "max 14 words", "why_now": "max 18 words" }
  ]
}

todays_edge: 0-3 alerts total — only include if genuinely time-sensitive. Empty arrays OK.
radar_watch: 2-4 thematic stocks the user does NOT own.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 1800 });
}

async function chunkConvictionWatch(
  name: string,
  watchlist: string[],
  holdings: any[],
  holdingsAgeDays: number | null,
  date: string
) {
  const focusTickers = (holdings && holdings.length > 0)
    ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol)
    : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0
    ? `\nFocus on these tickers: ${focusTickers.join(", ")}.`
    : "";
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times to check current technical setup and catalysts.${tickerNote}

Return ONLY:
{
  "conviction_watch": [
    { "ticker": "TICKER", "signal": "add or hold or trim", "why_now": "1-2 short sentences, max 25 words", "note": "tight summary, max 8 words", "action": "OPTIONAL concrete trade with size, max 12 words — omit for routine holds" }
  ]
}

3-5 entries.`;
  return callJsonChunk(prompt, { search: true, maxTokens: 1500 });
}

async function chunkDecisions(
  name: string,
  watchlist: string[],
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null,
  date: string
) {
  // Reuse the same holdings block format from buildPrompt for consistency
  let holdingsBlock = "";
  if (holdings && holdings.length > 0) {
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
      if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)} cost`);
      if (h.gainPct != null) {
        const sign = h.gainPct >= 0 ? "+" : "";
        parts.push(`${sign}${h.gainPct.toFixed(1)}%`);
      }
      return "    • " + parts.join(", ");
    };
    const groupBlocks: string[] = [];
    for (const [accountId, list] of Object.entries(groups)) {
      const label = accountId === "_unknown" ? "Unlabeled" : (accountLabel[accountId] || "Account");
      groupBlocks.push(`  Account: ${label}\n${list.map(formatHolding).join("\n")}`);
    }
    const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7
      ? ` (${holdingsAgeDays} days old — % gains approximate)`
      : "";
    holdingsBlock = `\n\nUSER'S HOLDINGS${ageNote}:\n${groupBlocks.join("\n\n")}\n`;
  }
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount
    ? `\nMULTI-ACCOUNT REQUIREMENT: User has positions in ${accounts.length} accounts. EVERY decision MUST name the specific account (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh"). Do NOT issue a decision without naming the account.`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
${holdingsBlock}
Generate 3-5 PERSONALIZED, ACTIONABLE trade decisions for today. Each must reference a SPECIFIC ticker the user holds (or watches), with their actual share count when known, plus a SPECIFIC action with reasoning. Cite real catalysts when relevant.${accountRule}

GOOD examples:
${multiAccount
    ? `- "Trim NVDA in Fidelity TOD: 30 of 75 sh into earnings strength."
- "Add 10 NVDA in Roth on dip below $850 support."`
    : `- "IONQ +45% on 175 sh — earnings 5/6. Trim 75 into Friday strength."
- "NVDA reports tonight. You hold 75 sh. Set $850 stop, no add pre-FOMC."`}

BAD (avoid): "Review highest-conviction position" / "Confirm cash balance" / "Pre-decide exits before catalysts" — too generic.

Format: [Account if multi-account] + [Ticker context] + [Specific action] + [Catalyst]. Max 16 words each.

Return ONLY:
{
  "decisions": ["3-5 decision strings"]
}`;
  return callJsonChunk(prompt, { maxTokens: 1200 });
}

function buildPrompt(
  name: string,
  watchlist: string[],
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null,
  date: string
) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";

  // Build a structured holdings block when available
  let holdingsBlock = "";
  if (holdings && holdings.length > 0) {
    // Build a label map from accountId to human-friendly account name
    const accountLabel: Record<string, string> = {};
    if (Array.isArray(accounts)) {
      for (const a of accounts) {
        if (a && a.id) accountLabel[a.id] = a.name || "Account";
      }
    }

    // Group holdings by account so the prompt clearly conveys which positions
    // sit in which account. This is what lets Claude write playbook items
    // like "Trim NVDA in Fidelity TOD: 30 of 75 sh."
    const groups: Record<string, any[]> = {};
    for (const h of holdings) {
      const key = h.accountId || "_unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    }

    const formatHolding = (h: any) => {
      const parts = [`${h.symbol}`];
      if (h.qty != null) parts.push(`${h.qty} sh`);
      if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)} cost`);
      if (h.value != null) parts.push(`$${h.value.toFixed(0)} value`);
      if (h.gainPct != null) {
        const sign = h.gainPct >= 0 ? "+" : "";
        parts.push(`${sign}${h.gainPct.toFixed(1)}%`);
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
      ? ` (NOTE: User's holdings data is ${holdingsAgeDays} days old — prices have shifted; treat % gains as approximate.)`
      : "";
    const accountCount = Object.keys(groups).length;
    const accountNote = accountCount > 1
      ? ` The user holds these positions across ${accountCount} accounts. When writing playbook items, ALWAYS name the specific account (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh") so the user knows exactly where to act.`
      : "";
    holdingsBlock = `\n\nUSER'S ACTUAL HOLDINGS${ageNote}${accountNote}\n${groupBlocks.join("\n\n")}\n`;
  }

  return `You are a JSON generator. Output ONLY a single valid JSON object. No prose. No markdown. Start with { and end with }.

Generate a morning briefing for ${name || "the user"}. Today is ${date}. Watchlist: ${tickers}.${holdingsBlock}
USER PROFILE: The reader is an active multi-account swing trader managing a portfolio through earnings cycles, FOMC events, and sector rotations. They blend technical analysis (golden cross, MACD, RSI, ADX) with fundamental catalysts (earnings, Fed decisions, geopolitical risk) and smart-money signals (13F filings, congressional disclosures via STOCK Act, insider Form 4s). They are sophisticated — speak to that level. No beginner advice. No "consider diversifying" or "do your own research" filler. They already know.

THEMATIC FOCUS — the user invests heavily in: AI infrastructure, semiconductors, quantum computing, crypto-mining-to-HPC pivots, nuclear energy, rare earths/critical minerals, and speculative biotech (GLP-1, oncology). When surfacing thematic stocks, draw from these themes.

You have access to web_search. Use it to fetch the MOST RECENT and HIGHEST-IMPACT data — especially for smart_money (latest 13F disclosures, latest congressional STOCK Act filings, biggest insider Form 4 trades from the past 1-2 weeks), market_pulse (today's premarket movement, today's headlines, today's macro events), radar_watch (thematic stocks moving today the user does NOT own), and CRITICALLY: any earnings dates, ex-dividend dates, or known catalysts in the next 1-2 weeks for the user's actual holdings. Use up to 5 searches. Prioritize signal over volume.

WRITING STYLE RULES (critical):

1. DEFAULT TO BULLETS, NOT PARAGRAPHS. Every section should be scannable. Avoid run-on sentences. Each bullet/note: short, precise, useful — never filler. The brief should help the reader DECIDE, not make them read.

2. mindset.gratitude must be a STIMULATING AFFIRMATION drawn from one of three rotating voices (vary by day):
   • STOIC WARRIOR — Marcus Aurelius / Seneca / Epictetus energy: sharp, decisive, the obstacle is the path, what's in your control vs not, build the character today
   • QUIET POWER — Lao Tzu / Rumi / Thich Nhat Hanh energy: stillness as strength, fire underneath the calm, patience that compounds, the quiet mind that sees what others miss
   • ATHLETE MINDSET — grounded performance language: today is a rep, process over outcome, recovery is part of the work, show up the same on green and red days, long-season thinking
   The line must be DECLARATIVE and ACTIVATING — never soft, never "walk gently," never passive resignation. It gives the reader fire or steadiness — depending on the voice — but always with edge. No religion-specific language. Address the reader by name when natural. Maximum 18 words.

3. mindset.fuel must be a STRUCTURED 10-MINUTE VITALITY ROUTINE for someone fit and capable, no equipment needed. Format exactly as: "10-min vitality routine: [2 min mobility] · [3 min breathwork] · [3 min strength] · [2 min stretch]." Vary the specific exercises each day. Keep each segment under 10 words.

4. smart_money is THE MOST IMPORTANT SECTION OF THE BRIEF — the meat-and-potatoes for the user. It must contain:

   a. summary: object with these fields:
      - "most_bought": ARRAY of EXACTLY 2 tickers — the top 2 most-frequently bought names across all whale/congress/hedge fund activity today, ranked by frequency (e.g. ["NVDA", "MSFT"])
      - "most_sold": ARRAY of EXACTLY 2 tickers — the top 2 most-frequently sold or trimmed names today, ranked by frequency (e.g. ["AAPL", "TSLA"])
      - "net_bullish_sectors": 2-3 sector names where smart money is net buying. Use plain English sector names (e.g. "AI Infrastructure", "Nuclear / Power", "Semiconductors", "Critical Minerals", "Biotech")
      - "net_bearish_sectors": 1-2 sector names where smart money is net selling

   b. sector_heatmap: 6-10 sectors with directional flow signals. Each entry is an object:
      - "sector": sector name, max 22 chars
      - "direction": "buying" | "selling" | "neutral"
      - "intensity": 1-5 (1 = light flow, 5 = heavy flow)
      Cover the user's themes (AI / semis / nuclear / quantum / rare earths / biotech) plus any other sectors with notable flow today.

   c. whale_moves: EXACTLY 5 entries — institutional 13F filings from major investors (Berkshire, Bridgewater, Pershing Square, Tepper Appaloosa, Druckenmiller Duquesne, Soros, Tudor Jones, Howard Marks Oaktree, etc.)
   d. congress_moves: EXACTLY 5 entries — STOCK Act disclosures from named members of Congress (Pelosi, Tuberville, Crenshaw, Greene, Whitehouse, Khanna, etc.)
   e. hedge_fund_moves: EXACTLY 5 entries — fund-level rotations distinct from the whales above. Use names like Citadel, Renaissance, Two Sigma, Millennium, Coatue, D.E. Shaw, Point72, Tiger Global, Lone Pine.

   IMPORTANT: whale_moves and hedge_fund_moves should NOT overlap — keep institutional 13F filers (Berkshire, Pershing, Tepper) in whale_moves, and quant/multi-strat hedge funds (Citadel, Renaissance, Millennium) in hedge_fund_moves.

   Each entry in whale_moves / congress_moves / hedge_fund_moves is an OBJECT with three fields:
   - "text": specific trade with named entity + ticker + size estimate + approximate date when known. Examples: "Berkshire trimmed AAPL ~13% (Q1 13F)", "Pelosi disclosed $1-5M META calls (4/12)", "Pershing Square added 1.2M GOOGL". Avoid vague language like "hedge funds" or "asset managers" — use real fund/politician names.
   - "ticker": the primary ticker mentioned (e.g., "AAPL")
   - "source_url": a public verification URL on a USER-FRIENDLY free site:
     • For 13F / institutional whale moves: prefer https://whalewisdom.com/filer/[fund-slug] or https://stockcircle.com/portfolio/[investor-slug] or https://hedgefollow.com/funds/[Fund+Name]
     • For congressional trades: prefer https://www.capitoltrades.com/politicians/[ID] or https://www.capitoltrades.com/trades or https://www.quiverquant.com/congresstrading/
     • For hedge fund quant moves: prefer https://whalewisdom.com or https://hedgefollow.com
     • For insider Form 4 trades: prefer http://openinsider.com/screener?s=[TICKER]
     • Avoid SEC EDGAR direct links — too dense for end users
   Prioritize the MOST RECENT, HIGHEST-IMPACT disclosures.

5. conviction_watch must reference STOCKS THE USER ACTUALLY OWNS (when holdings are provided). Each entry is an object with:
   - "ticker": the ticker
   - "signal": "add", "hold", or "trim"
   - "why_now": 1-2 SHORT sentences (under 25 words total) explaining the CURRENT reasoning — what's happening with this position right now, near-term catalyst, technical setup, or thesis status. Examples: "Earnings 5/20. Implied move ~7%. Already trimmed last week — no add into print." or "Down 8% on broader semis pullback. Support holding. Wait for volume reversal before any add."
   - "note": a tight punchy summary, max 8 words. Examples: "Hold through earnings.", "Add on volume confirmation.", "Lock half the gains."
   - "action" (OPTIONAL — only include for HIGH-CONVICTION specific actions today, omit for routine holds): a single concrete trade action with size. Examples: "Trim 25 shares before close.", "Add 10 shares on dip below $180.", "Sell half — lock 35% gain." Max 12 words. Only include this field when there is a clear, actionable trade for today. If unsure, omit. Do not fabricate urgency.

5a. todays_edge is a NEW REQUIRED TIER-1 ALERT SECTION — the most time-sensitive, highest-priority items the user MUST see when they open the app today. This drives a hero alert strip at the top of the brief. The structure is an object with three optional arrays — INCLUDE ONLY ALERTS THAT GENUINELY APPLY TODAY. Empty arrays are fine. Do not pad with weak alerts — quality over quantity, target 0-3 alerts total across all categories.
   - "earnings_alerts": array of objects for earnings reports happening TODAY or TOMORROW for tickers the user holds. Each: { "ticker": "AAPL", "when": "today after close" | "tomorrow before open" | etc., "your_shares": number_if_known }
   - "binary_catalysts": array of objects for major events within 30 days (earnings, FDA, court rulings, ex-div) for the user's holdings. Each: { "ticker": "IONQ", "event": "earnings 5/6", "context": "after 41% run-up — consider trim before print" }. Max context 12 words.
   - "risk_flags": array of objects for concentration risk, position size warnings, or thesis-broken signals. Each: { "ticker": "GE", "flag": "44% of Roth IRA — concentration risk", "suggested_action": "trim toward 20 shares" }. Max flag/action 12 words each.
   When user holdings are NOT provided, todays_edge can use the watchlist tickers + general market catalysts. If genuinely nothing is time-sensitive, return empty arrays for all three — that's correct, don't manufacture alerts.

6. radar_watch is a NEW REQUIRED SECTION — thematic stocks the user DOES NOT own (not in their holdings list) but should be aware of today, drawn from their themes (AI / semis / nuclear / quantum / rare earths / biotech). 2-4 entries. Each entry is an object with:
   - "ticker": the ticker
   - "theme": short theme tag, max 4 words. Examples: "Nuclear · AI energy", "Semiconductors · AI infra", "Rare earths"
   - "headline": 1 short sentence on what's moving, max 14 words. Example: "TSMC raised 2026 capex guidance — accelerating AI chip buildout"
   - "why_now": 1 sentence on why this matters to the user TODAY, max 18 words. Example: "Whale accumulation visible last quarter. Chinese fab restrictions tighten the supply story further."
   When holdings are provided, EXCLUDE any tickers the user already owns. When holdings are not provided, just surface themes that match the user's interests.

7. clarity is a NEW REQUIRED SECTION for spiritual/contemplative grounding. It is an object with three fields:
   - "contemplation": ONE sentence to sit with for 60 seconds before market open. Reflective, present-tense, in the user's voice ("I" or unnamed). Universal — not religion-specific. Max 22 words.
   - "eastern_wisdom": an object with:
     • "quote": a real quote from Eastern contemplative traditions — Lao Tzu, Rumi, Thich Nhat Hanh, Marcus Aurelius (Stoic, included for parallel wisdom traditions), Buddha/Dhammapada, Vedanta texts, Sanskrit teachings, Zen masters. Real attributed quotes only — no fabrications. Max 30 words.
     • "source": who said it (e.g., "Rumi", "Lao Tzu", "Buddha (Dhammapada)", "Sanskrit teaching")
   - "breath_practice": an object with:
     • "name": name of a real breath practice. Examples: "Box Breathing", "4-7-8 Calm Breath", "Coherent Breathing", "Bhramari (Bee Breath)", "Nadi Shodhana", "Physiological Sigh", "Ujjayi (Ocean Breath)"
     • "pattern": the timing pattern in plain text. Examples: "4 in · 4 hold · 4 out · 4 hold", "Inhale 4 · hold 7 · exhale 8", "5 seconds in · 5 seconds out"
     • "description": 1 short sentence on the physiological or psychological effect, max 24 words
     • "rounds": how many rounds or how long, e.g. "Repeat 4 rounds", "Continue for 3 minutes"
   Vary the contemplation, wisdom quote, and breath practice across days. Tie the contemplation to the day's market mood when natural — but keep it universal, not market-specific.

8. decisions (Today's Playbook) is THE MOST IMPORTANT FIELD. It must be PERSONALIZED, ACTIONABLE TRADE RECOMMENDATIONS based on the user's actual holdings and today's catalysts — NOT generic principles or to-do lists. The user does not need to be told to "review their portfolio" — they need to be told WHAT TO DO with their specific positions today.

   ${holdings && holdings.length > 0 ? `When holdings are provided, EVERY decision must reference a SPECIFIC ticker the user holds, with their actual share count and gain/loss when known, plus a SPECIFIC action with reasoning. Cite real catalysts (earnings dates, ex-div dates, FOMC, CPI) when relevant.

   ${accounts && Array.isArray(accounts) && accounts.length > 1 ? `MULTI-ACCOUNT REQUIREMENT: The user holds positions across ${accounts.length} accounts. EVERY decision MUST name the specific account so the user knows exactly where to act. Use the account names exactly as listed in the holdings block above (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh"). Do NOT issue a decision without naming the account.` : ""}` : `When holdings are NOT provided, reference watchlist tickers and known market catalysts. Encourage user to upload their CSV for fully personalized recommendations.`}

   GOOD examples (personalized, specific):
   ${accounts && Array.isArray(accounts) && accounts.length > 1 ? `• "Trim NVDA in Fidelity TOD: 30 of 75 sh into earnings strength."
   • "IONQ in TOD +45% on 175 sh — trim 75 before 5/6 print."
   • "Add 10 NVDA in Roth on dip below $850 support."` : `• "IONQ +45% on 175 sh — earnings 5/6. Trim 75 into Friday strength, keep 100."
   • "NVDA reports tonight. You hold 75 sh. Set $850 stop, no add pre-FOMC."
   • "VRT 35sh down 8% — bottom forming. Add ½ unit if $112 holds support."`}

   BAD examples to AVOID (generic, work for anyone):
   • "Review highest-conviction position." (which one? what to do?)
   • "Confirm cash balance." (this is a checklist task, not analysis)
   • "Pre-decide exits before catalysts." (what catalysts? which positions?)
   • "Trim winners into strength." (which winners? how much?)
   • "Practice gratitude." (not a trade decision)

   For each decision, the format should be: [Account if multi-account] + [Ticker context] + [Specific action] + [Reasoning/catalyst]. Maximum 16 words per item to keep it scannable.

9. market_pulse: BULLETS ONLY. The "summary" field should be a SHORT 1-sentence headline (max 14 words). The "key_levels" array should have 4-6 tight bullets (max 10 words each) covering: index futures, VIX, key commodities, sector rotation, and any major catalyst on deck today.

10. affirmation field is the headline at top of brief — short, sharp, max 12 words.

11. power_plate is a NEW REQUIRED SECTION — a single dinner recipe with 30g+ protein, ~20-35 min prep, no exotic equipment. Vary the diet style daily across three rotations: "High Protein", "Mediterranean", "Anti-Inflammatory". Object fields:
   - "name": recipe name, max 6 words. Examples: "Sheet Pan Chicken & Greens", "Mediterranean Salmon Bowl", "Turmeric Lentil & Shrimp Skillet"
   - "style": one of "High Protein", "Mediterranean", "Anti-Inflammatory"
   - "protein_g": integer grams of protein, must be at least 30
   - "prep_min": integer minutes total prep + cook time, between 15 and 45
   - "description": 1-2 sentences on what it is and why it works, max 28 words
   - "groceries": array of 4-6 grocery line items the user can take to the store. Format each as a normal shopping list line. Example: "1 lb chicken breast, cubed", "1 large head broccoli", "Olive oil · garlic · paprika · salt · pepper" (combining staples on one line is fine)
   - "prep_steps": array of 4-5 short cooking steps, max 18 words each. Plain imperative voice. Example: "Heat oven to 425°F. Toss chicken with olive oil, paprika, garlic, salt."

Output exactly:
{
  "affirmation": "short sharp opening line, max 12 words",
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each"]
  },
  "smart_money": {
    "summary": {
      "most_bought": ["TICKER1", "TICKER2"],
      "most_sold": ["TICKER1", "TICKER2"],
      "net_bullish_sectors": ["2-3 sector names"],
      "net_bearish_sectors": ["1-2 sector names"]
    },
    "sector_heatmap": [
      { "sector": "sector name max 22 chars", "direction": "buying or selling or neutral", "intensity": 1 }
    ],
    "whale_moves": [ { "text": "named trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ],
    "congress_moves": [ { "text": "named congressional trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ],
    "hedge_fund_moves": [ { "text": "named hedge fund trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ]
  },
  "todays_edge": {
    "earnings_alerts": [ { "ticker": "TICKER", "when": "today after close", "your_shares": 0 } ],
    "binary_catalysts": [ { "ticker": "TICKER", "event": "event date", "context": "concise context, max 12 words" } ],
    "risk_flags": [ { "ticker": "TICKER", "flag": "flag, max 12 words", "suggested_action": "action, max 12 words" } ]
  },
  "radar_watch": [
    { "ticker": "TICKER", "theme": "short theme tag", "headline": "what's moving today, max 14 words", "why_now": "why it matters today, max 18 words" }
  ],
  "conviction_watch": [
    { "ticker": "TICKER", "signal": "add or hold or trim", "why_now": "1-2 short sentences on current reasoning, max 25 words", "note": "tight punchy summary, max 8 words", "action": "OPTIONAL concrete trade with size, max 12 words — omit for routine holds" }
  ],
  "mindset": {
    "gratitude": "stimulating affirmation in one of three voices, max 18 words",
    "fuel": "structured 10-min routine in the format described above",
    "focus": "concrete breath/mental cue, max 10 words"
  },
  "clarity": {
    "contemplation": "ONE present-tense sentence to sit with, max 22 words",
    "eastern_wisdom": { "quote": "real attributed quote, max 30 words", "source": "attribution" },
    "breath_practice": { "name": "named technique", "pattern": "timing pattern in plain text", "description": "physiological effect, max 24 words", "rounds": "how many rounds or how long" }
  },
  "power_plate": {
    "name": "recipe name, max 6 words",
    "style": "High Protein or Mediterranean or Anti-Inflammatory",
    "protein_g": 30,
    "prep_min": 25,
    "description": "1-2 short sentences, max 28 words",
    "groceries": ["4-6 grocery line items"],
    "prep_steps": ["4-5 short cooking steps, max 18 words each"]
  },
  "decisions": ["3-5 PERSONALIZED trader actions referencing user's actual holdings + today's catalysts, max 14 words each"]
}`;
}
