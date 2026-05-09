import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Two-tier brief cache ────────────────────────────────────────────────
// L1: in-memory Map (fast, but dies on cold starts)
// L2: Upstash Redis (slower ~50ms, but survives cold starts)
//
// Read path: check L1 first; if miss, check L2 and populate L1.
// Write path: write to both. If Upstash isn't configured (env vars missing,
// e.g. local dev), L2 is silently skipped — behavior degrades gracefully
// to old in-memory-only mode.
//
// TTL: 12 hours. The brief from this morning persists through the trading
// day on cold starts so cross-device opens hit cache.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = Math.floor(CACHE_TTL_MS / 1000);

const briefCache = new Map<string, { brief: any; storedAt: number }>();

// Initialize Upstash client. Vercel's marketplace integration creates env
// vars with a KV_ prefix by default (KV_REST_API_URL, KV_REST_API_TOKEN).
// We also fall back to the Upstash-native UPSTASH_REDIS_REST_* names so
// either naming convention works. If neither is set, redis stays null and
// L2 caching is silently disabled (graceful degradation for local dev).
let redis: Redis | null = null;
try {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
} catch (err) {
  console.warn("Upstash Redis init failed; falling back to in-memory only:", err);
  redis = null;
}

// L1+L2 read. Returns the brief or null.
async function cacheReadBrief(cacheKey: string): Promise<any | null> {
  // L1 — in-memory Map
  const memHit = briefCache.get(cacheKey);
  if (memHit && Date.now() - memHit.storedAt < CACHE_TTL_MS) {
    return memHit.brief;
  }
  // L2 — Upstash Redis (skip if not configured)
  if (!redis) return null;
  try {
    const kvHit = await redis.get<any>(`brief:${cacheKey}`);
    if (kvHit && kvHit.brief) {
      // Populate L1 so subsequent reads on this warm worker are fast
      briefCache.set(cacheKey, { brief: kvHit.brief, storedAt: Date.now() });
      return kvHit.brief;
    }
  } catch (err) {
    // Don't let cache errors break the request — just log and fall through
    console.warn("Upstash read failed:", err);
  }
  return null;
}

// L1+L2 write. Best-effort — failures are logged, not thrown.
async function cacheWriteBrief(cacheKey: string, brief: any): Promise<void> {
  briefCache.set(cacheKey, { brief, storedAt: Date.now() });

  // Cleanup L1 if it grows too large
  if (briefCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of briefCache.entries()) {
      if (now - v.storedAt > CACHE_TTL_MS) briefCache.delete(k);
    }
  }

  if (!redis) return;
  try {
    await redis.set(
      `brief:${cacheKey}`,
      { brief, storedAt: Date.now() },
      { ex: CACHE_TTL_SECONDS }
    );
  } catch (err) {
    console.warn("Upstash write failed:", err);
  }
}

function buildCacheKey(input: {
  name: string;
  watchlist: string[];
  holdings: any[];
  date: string;
}) {
  const bucket = Math.floor(Date.now() / CACHE_TTL_MS);
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
    const wantsStream = url.searchParams.get("stream") === "1";
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
    if (!fresh) {
      const cachedBrief = await cacheReadBrief(cacheKey);
      if (cachedBrief) {
        // Cache hit — return immediately. For streaming requests, emit a
        // single "complete" event with the full brief so the client gets
        // the same UI flow.
        if (wantsStream) {
          return streamCachedBrief(cachedBrief);
        }
        return NextResponse.json({ brief: cachedBrief, cached: true });
      }
    }

    // ─── STREAMING path ─────────────────────────────────────────────────
    // For fresh generation, stream chunks to the client as they complete.
    // The user sees Affirmation/Mindset arrive in ~1-2s (Haiku), then
    // Pulse/Edge in ~10-15s, then Smart Money + Conviction in ~25-35s.
    // No more 60-90 second blank screen.
    if (wantsStream) {
      return streamFreshBrief({
        name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey,
      });
    }

    // ─── Non-streaming path (legacy / cache-miss fallback) ──────────────
    // Same Promise.allSettled flow as before. Client either uses stream OR
    // falls back to this if streaming isn't supported.
    const tasks = [
      generateLightChunk(name, holdings, accounts, holdingsAgeDays, date),
      generatePulseAndEdge(name, watchlist, holdings, date),
      generateSmartMoneyOnly(name, date),
      generateConvictionAndOpportunity(name, watchlist, holdings, date),
    ];

    const results = await Promise.allSettled(tasks);
    const merged: any = {};
    const failures: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        Object.assign(merged, r.value);
      } else if (r.status === "rejected") {
        failures.push(r.reason?.message || "unknown");
      }
    }

    if (Object.keys(merged).length === 0) {
      return NextResponse.json(
        { error: `All chunks failed: ${failures.join("; ")}` },
        { status: 502 }
      );
    }

    await cacheWriteBrief(cacheKey, merged);

    return NextResponse.json({
      brief: merged,
      cached: false,
      partial: failures.length > 0 ? { failedChunks: failures.length } : undefined,
    });
  } catch (err: any) {
    console.error("Brief generation failed:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}

// ─── SSE streaming helpers ────────────────────────────────────────────
// Server-Sent Events emit a sequence of `event: <name>\ndata: <json>\n\n`
// frames. Frontend listens with EventSource (or a fetch reader for POST).
//
// Frame types:
//   - "chunk"    — partial brief data { fields: {...}, chunkName: "light" }
//   - "complete" — final merge done, brief cached { brief: {...} }
//   - "error"    — chunk failed, brief continues without it
//   - "done"     — stream end (also closes the underlying connection)

function sseEncode(eventName: string, data: any): string {
  const json = JSON.stringify(data);
  return `event: ${eventName}\ndata: ${json}\n\n`;
}

function streamCachedBrief(brief: any): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(sseEncode("chunk", { chunkName: "cached", fields: brief })));
      controller.enqueue(encoder.encode(sseEncode("complete", { brief, cached: true })));
      controller.enqueue(encoder.encode(sseEncode("done", {})));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function streamFreshBrief(opts: {
  name: string;
  watchlist: string[];
  holdings: any[];
  accounts: any[];
  holdingsAgeDays: number;
  date: string;
  cacheKey: string;
}): Response {
  const { name, watchlist, holdings, accounts, holdingsAgeDays, date, cacheKey } = opts;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (eventName: string, data: any) => {
        controller.enqueue(encoder.encode(sseEncode(eventName, data)));
      };

      // Initial "started" frame so the client knows generation has begun
      send("chunk", { chunkName: "started", fields: {} });

      const merged: any = {};
      const failures: string[] = [];

      // Each chunk runs in parallel (Promise.allSettled) but we wire up
      // .then handlers so the client gets each one the moment it lands —
      // not after all three finish.
      const tasks = [
        { name: "light", promise: generateLightChunk(name, holdings, accounts, holdingsAgeDays, date) },
        { name: "pulse", promise: generatePulseAndEdge(name, watchlist, holdings, date) },
        { name: "smart_money", promise: generateSmartMoneyOnly(name, date) },
        { name: "conviction", promise: generateConvictionAndOpportunity(name, watchlist, holdings, date) },
      ];

      // Wire up each task's resolution to send a chunk frame
      const wired = tasks.map((t) =>
        t.promise.then(
          (val) => {
            if (val && typeof val === "object") {
              Object.assign(merged, val);
              send("chunk", { chunkName: t.name, fields: val });
            }
          },
          (err) => {
            failures.push(`${t.name}: ${err?.message || "unknown"}`);
            send("error", { chunkName: t.name, message: err?.message || "Chunk failed" });
          }
        )
      );

      // Wait for all to settle (success or failure)
      await Promise.all(wired);

      if (Object.keys(merged).length === 0) {
        send("error", { fatal: true, message: `All chunks failed: ${failures.join("; ")}` });
      } else {
        // Cache the merged brief for next time (writes to L1 + L2)
        await cacheWriteBrief(cacheKey, merged);
        send("complete", {
          brief: merged,
          cached: false,
          partial: failures.length > 0 ? { failedChunks: failures.length } : undefined,
        });
      }

      send("done", {});
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Chunk helpers ────────────────────────────────────────────────────
// Each chunk is a focused Anthropic call. Keep prompts tight so each call
// runs in 5-15 seconds. Web search is opt-in per chunk to avoid wasting
// search slots on chunks that don't need them.

const COMMON_PREAMBLE = (name: string, date: string) =>
  `You are a JSON generator. Output ONLY a single valid JSON object — no prose, no markdown, no code fences. Start with { and end with }.

Generate part of a morning briefing for ${name || "the user"} on ${date}. The reader is a sophisticated multi-account swing trader who knows technical analysis, smart-money signals (13F, STOCK Act, Form 4s), and macro catalysts. No beginner advice. No filler. They invest in: AI infrastructure, semiconductors, quantum computing, crypto-mining-to-HPC, nuclear, rare earths, and speculative biotech.
`;

async function callJsonChunk(
  prompt: string,
  opts: { search?: boolean; maxTokens?: number; maxSearches?: number; model?: string } = {}
) {
  const { search = false, maxTokens = 2500, maxSearches = 3, model = "claude-sonnet-4-5" } = opts;
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    ...(search
      ? {
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: maxSearches,
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
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  // Strip <cite ...>...</cite> tags from every string in the response.
  // The web_search tool injects these for source attribution, but they
  // leak into the brief content as raw text and look broken to users.
  return stripCiteTags(parsed);
}

// Recursively walk a JSON value and remove <cite ...>...</cite> wrappers
// from any string, keeping only the inner text. Also strips bare <cite>
// open/close tags if encountered. Idempotent and safe on any value type.
function stripCiteTags<T>(value: T): T {
  if (typeof value === "string") {
    return value
      // Remove <cite index="..">...</cite> wrappers, keep inner text
      .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
      // Remove any orphaned bare cite tags
      .replace(/<\/?cite\b[^>]*>/gi, "")
      // Collapse any double-spaces left behind
      .replace(/[ \t]{2,}/g, " ")
      .trim() as any;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripCiteTags(v)) as any;
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      out[k] = stripCiteTags(v);
    }
    return out;
  }
  return value;
}

// Chunk 1: Light content (no web search) — affirmation, mindset, clarity,
// power_plate, decisions. Decisions live here too because they only need
// the user's holdings (already in the prompt) — no fresh web data.
// Uses Haiku for ~3-4s speedup since this chunk has no search dependency.
async function generateLightChunk(
  name: string,
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null,
  date: string
) {
  const holdingsBlock = formatHoldingsBlock(holdings, accounts, holdingsAgeDays);
  const multiAccount = Array.isArray(accounts) && accounts.length > 1;
  const accountRule = multiAccount
    ? `\nMULTI-ACCOUNT REQUIREMENT: User has positions in ${accounts!.length} accounts. EVERY decision MUST name the specific account (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh").`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}${holdingsBlock}

Return ONLY this JSON shape with all fields populated:

{
  "affirmation": "short sharp opening line, max 12 words",
  "mindset": {
    "gratitude": "stimulating affirmation in one of three rotating voices (Stoic warrior / Quiet power / Athlete mindset), max 18 words. Vary by day.",
    "fuel": {
      "headline": "Short summary of the routine in one phrase, max 14 words (e.g. '10-min activation flow: mobility, breath, strength')",
      "total_min": 10,
      "blocks": [
        {
          "name": "Mobility (2 min)",
          "moves": ["3-4 specific movements with reps or duration, max 14 words each (e.g. '15 cat-cow flows, slow tempo')"],
          "why": "1 sentence (max 18 words) on what this block prepares — joint warmup, blood flow, etc."
        },
        {
          "name": "Breathwork (3 min)",
          "moves": ["2-3 breath patterns with timing (e.g. '8 rounds box breath: 4s in, 4s hold, 4s out, 4s hold')"],
          "why": "1 sentence on physiological effect — nervous system shift, focus, etc."
        },
        {
          "name": "Strength (3 min)",
          "moves": ["3-4 bodyweight movements with reps (e.g. '30s plank → 12 push-ups → 20 air squats')"],
          "why": "1 sentence on muscle activation, metabolic boost, etc."
        },
        {
          "name": "Cooldown (2 min)",
          "moves": ["2-3 stretches with hold duration (e.g. '30s hamstring stretch each side')"],
          "why": "1 sentence on flexibility and parasympathetic shift."
        }
      ],
      "tip": "1-2 sentence pro tip — form cue, common mistake to avoid, or motivation. Plain-English."
    },
    "focus": "concrete breath/mental cue, max 10 words"
  },
  "clarity": {
    "contemplation": "ONE present-tense sentence to sit with for 60 seconds, max 22 words",
    "eastern_wisdom": { "quote": "real attributed quote from Lao Tzu / Rumi / Thich Nhat Hanh / Marcus Aurelius / Buddha / Vedanta / Zen masters, max 30 words", "source": "attribution" },
    "breath_practice": { "name": "Box / Coherent / 4-7-8 / Bhramari / Nadi Shodhana / Physiological Sigh / Ujjayi", "pattern": "timing pattern", "description": "physiological effect, max 24 words", "rounds": "rounds or duration" }
  },
  "power_plate": {
    "name": "recipe name, max 6 words",
    "style": "High Protein or Mediterranean or Anti-Inflammatory",
    "protein_g": 30,
    "prep_min": 25,
    "description": "4-5 sentences (110-150 words) describing the dish like a thoughtful chef would: open with the sensory hook (aroma, color, what hits the plate first), then walk through flavor profile and texture (creamy / crunchy / bright / smoky / umami-rich), then mention the best moment to eat it (post-workout, end of a long screen day, light dinner), and close with what makes it deeply satisfying — the protein anchor, the contrast of textures, the way the seasoning lands. Make it inviting, not clinical. The user should want to cook it.",
    "why_this_meal": "120-170 word plain-English paragraph explaining WHY this meal supports the user's goals today. Cover FOUR things: (1) the macronutrient story — protein for muscle and satiety, healthy fats for brain and hormones, complex carbs for steady energy, fiber for gut health; (2) any anti-inflammatory or specific nutrient angles (omega-3s, polyphenols, magnesium, choline) and what they do in plain language; (3) tie to the day's mood/intent — high-focus day, recovery day, social evening; (4) a brief sentence on long-term benefit (cardiovascular, cognitive, blood sugar stability). Like a thoughtful friend with nutrition knowledge explaining the choice over coffee. Define any technical term in the same sentence (e.g. 'polyphenols — plant compounds that reduce inflammation').",
    "groceries": ["7-10 specific grocery line items with rough quantities AND a brief tag (1-3 words) on what to look for at the store. Examples: '8oz wild salmon — bright pink, no fishy smell', '1 large lemon — heavy for size = juicier', '2 cups baby spinach — deep green, no wilting', '3 cloves garlic — firm, no green sprouts'. The tag helps a beginner shopper pick the good version."],
    "prep_steps": ["7-9 cooking steps, 25-40 words each. Each step should include: the action, a timing cue (e.g. '4-5 minutes per side'), and a sensory tell (what to look/listen/smell for so beginners know it's working — 'until edges turn golden', 'when garlic smells nutty, not burnt', 'when oil shimmers but doesn't smoke'). Number-friendly instructions a confident beginner can follow without watching a video."],
    "swap_options": ["3-4 simple substitutions a user can make. Format each as: 'Sub X → Y if [reason]' (e.g. 'Sub salmon → chicken thigh if pescatarian-averse', 'Sub quinoa → cauliflower rice for lower carb', 'Sub spinach → kale if you prefer firmer greens')"],
    "pairing": "2-3 sentences (35-55 words) on what to drink or serve alongside, and why it works (acidity cuts fat, herbs echo the dish, etc). Examples: 'Pair with sparkling water + a wedge of lemon — the acidity lifts the salmon and resets your palate between bites. If wine, a crisp Sauvignon Blanc echoes the herb notes without competing.'"
  },
  "decisions": [
    "8-10 PERSONALIZED trade actions/observations referencing the user's actual holdings + today's catalysts. Each STRING max 16 words. TARGET 10. Mix urgent moves (specific buy/trim with catalyst) with thoughtful holds on other major positions ('Hold IBM core through 5/15 — no catalyst, position working'). Every meaningful position deserves a line so the user gets full portfolio coverage, not just 3 hot takes. Format: [Account if multi-account] + [Ticker] + [Specific action or hold rationale] + [Catalyst or status]."
  ],
  "decisions_reasoning": [
    "For EACH decision above (same order, same length), a 130-180 word explanation written for someone NEW to trading. Cover: WHY this matters now (what's happening that triggered the suggestion) — WHY YOU MIGHT WANT TO DO IT (what problem it solves or opportunity it captures) — WHAT TO THINK ABOUT BEFORE DOING IT (your cost basis, how much you own, taxes) — WHY YOU MIGHT NOT WANT TO (the case against). PLAIN ENGLISH RULES: explain any technical term in the same sentence you use it (e.g. 'asymmetric — meaning the upside and downside aren't equal'). Never assume the reader knows trading slang. Use 'you' and 'your' to make it personal. Write like you're explaining to a smart friend who's never invested before. No bullet points. Full paragraphs."
  ]
}
${accountRule}

GOOD decision examples: "IONQ +45% on 175sh — earnings 5/6. Trim 75 into Friday strength." / "NVDA reports tonight, you hold 75sh. Set $850 stop pre-FOMC."
BAD examples to avoid: "Review highest-conviction position" / "Confirm cash balance" — too generic.

PRIMARY DECISION INPUT: This brief is the user's main source for what-to-do-today. Aim for 8-10 high-conviction action items, but quality over quantity — if you don't have a clear take on a 9th or 10th item, return only the strong ones (5-7 is fine if that's all you genuinely have).

decisions_reasoning EXAMPLE (for a TRIM IONQ decision) — note the simple language:
"IONQ has gone up 45% in just one month, and the company is reporting earnings on May 6 — that's only days away. Earnings reports are big moments where the stock can swing wildly in either direction. Trimming means selling part of your position to lock in some of those gains, while keeping the rest invested. The reason to consider trimming: the stock has already had a huge run, so a lot of good news may already be 'priced in' (built into the current price). If the earnings disappoint even a little, the stock could drop 15-20% in a single day. Before you sell anything, check your cost basis (what you originally paid). If you're up 200%+, you'll owe taxes on the gains. On the other hand, if you sell and earnings are amazing, you'll miss the next move up. Selling 75 of your 175 shares keeps you in the game with most of your shares while reducing the risk of a big drop."`;

  return callJsonChunk(prompt, { maxTokens: 8000, model: "claude-haiku-4-5" });
}

// Chunk 2: Market pulse + today's edge + radar watch (web search needed
// for premarket data, catalysts, and thematic movers).
async function generatePulseAndEdge(
  name: string,
  watchlist: string[],
  holdings: any[],
  date: string
) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const radarExclusion = ownedSet.size > 0
    ? `\nFor radar_watch: EXCLUDE any tickers the user already owns.`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch TODAY's premarket movement, headlines, macro events, and any earnings/FDA/catalysts in the next 1-2 weeks. Watchlist: ${tickers}.${ownedNote}${radarExclusion}

Return ONLY this JSON:

{
  "market_pulse": {
    "tone": "bullish or cautious or bearish",
    "summary": "ONE short headline sentence, max 14 words",
    "key_levels": ["4-6 short bullets, max 10 words each — index futures, VIX, key commodities, sector rotation, today's catalysts"]
  },
  "todays_edge": {
    "earnings_alerts": [ { "ticker": "TICKER", "when": "today after close" | "tomorrow before open", "your_shares": 0 } ],
    "binary_catalysts": [ { "ticker": "TICKER", "event": "event date", "context": "max 12 words" } ],
    "risk_flags": [ { "ticker": "TICKER", "flag": "max 12 words", "suggested_action": "max 12 words" } ]
  },
  "radar_watch": [
    {
      "ticker": "TICKER",
      "theme": "short tag e.g. 'Nuclear · AI energy'",
      "headline": "max 14 words",
      "why_now": "max 18 words",
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Explain WHY this stock matters right now (what specific event or trend), WHY IT'S WORTH WATCHING (what could go right), HOW IT FITS the user's interests (AI/semiconductors/nuclear/quantum/biotech — explain what each theme means if used), and WHAT COULD GO WRONG (the risk). PLAIN ENGLISH RULES: any technical term must be defined in the same sentence (e.g. 'capex — short for capital expenditure, the money companies spend on big purchases'). Use 'you' to make it personal. No bullet points. Like explaining to a friend who's curious but new."
    }
  ]
}

todays_edge: 0-3 alerts total — only if genuinely time-sensitive. Empty arrays are fine.
radar_watch: 4-6 high-conviction thematic stocks the user does NOT own. QUALITY OVER QUANTITY: 4 strong picks beat 6 mediocre ones. Each entry MUST include the deep_reasoning field — this is what the user reads when they tap to learn more.

PRIMARY DECISION INPUT: This brief is the user's main source for "what to do today" — what to buy, hold, trim, or watch. Filler content hurts trust. Only include items where you have a clear, defensible take backed by today's data. If a category has nothing genuinely high-conviction to say, return fewer items rather than padding.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 3200, maxSearches: 3 });
}

// Chunk 3a: Smart money ONLY (whale 13Fs + congress STOCK Act + hedge fund moves).
// Split out from the old combined chunk so it runs in parallel with conviction/
// opportunity. Cuts the long-pole wait roughly in half on cold start.
async function generateSmartMoneyOnly(
  name: string,
  date: string
) {
  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 3 times to fetch the LATEST 13F disclosures, biggest insider Form 4 trades from the past 1-2 weeks, and most recent congressional STOCK Act filings.

Return ONLY this JSON:

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
    "whale_moves": [ { "text": "named trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this firm or person and WHY are they worth watching (their AUM, track record, strategy in plain language) — WHAT EXACTLY did they do (the trade size, when, and what it likely signals about their conviction) — WHY THIS MATTERS for someone watching the markets today — WHAT TO BE CAREFUL OF (data delays, that this is a snapshot, that smart money makes mistakes too). Define any technical term in the same sentence." } ],
    "congress_moves": [ { "text": "named congressional trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this Congress member and WHY their trades draw attention (their committee assignments, what info they have access to, their disclosed track record) — WHAT EXACTLY they traded (size, when filed, when actually executed) — THE STOCK ACT context (30-45 day disclosure delay, what that means for retail investors trying to follow) — WHY THIS particular trade is interesting (timing relative to legislation, sector context, scale relative to their net worth). Define any technical term in the same sentence." } ],
    "hedge_fund_moves": [ { "text": "named hedge fund trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this hedge fund and HOW they operate (assets under management, investment style — quant/macro/long-short/activist — explain each style in plain language if used) — WHAT THIS TRADE represents in the context of their portfolio (a major rotation, a new theme, a hedge) — WHY THIS FUND IS WORTH WATCHING (track record, public-facing analysts, notable past calls) — KEY CAVEATS (13F shows positions only, not derivatives or shorts, ~45 day delay). Define any technical term in the same sentence." } ]
  }
}

CRITICAL DATA RULES:
- NEVER use placeholder strings like "DATA_UNAVAILABLE", "N/A", "NONE", "UNKNOWN", "TBD", or any all-caps placeholder.
- whale_moves, congress_moves, hedge_fund_moves: target 3-5 entries each. QUALITY OVER QUANTITY: better to return 3 real trades than 5 padded with filler. NEVER pad these categories with news, calendar notes, filing schedules, or political headlines. Every entry MUST be a SPECIFIC STOCK TRADE.
- Each entry in these categories MUST satisfy ALL of these:
   1. References a specific named person or fund (e.g. "Pelosi", "Citadel", "Buffett's Berkshire") — NOT generic phrases like "Ten members" or "GOP leadership"
   2. References a specific stock TICKER they bought, sold, added to, or trimmed — NOT a sector, country, or asset class generality
   3. The "ticker" field must contain a real ticker symbol (NVDA, MSFT, etc.) — NEVER "BTC" for crypto-news, NEVER blank
   4. The text reads as a TRADE: "Pelosi bought NVDA calls", "Citadel added 2M MSFT shares", "Buffett trimmed AAPL stake by 13%"
- BAD examples that should NEVER appear (these are news, not trades):
   * "Violations continue despite STOCK Act 45-day rule" — this is news commentary
   * "Bridgewater Q1 13F due mid-May" — this is a calendar note, not a trade
   * "Tiger Global holds US China India exposure" — vague, no ticker, no trade action
   * "GOP leadership delayed floor vote past Q1" — political news
   * "Ten members hold $750k-$2M crypto exposure" — generic, no named person, no specific trade
- For most_bought / most_sold: provide 1-2 ACTUAL ticker symbols based on your search. If you cannot find recent data, return an EMPTY ARRAY: [].
- If you genuinely cannot find 3 real trades for a category after searching, return whatever you have (1, 2, or 0). Empty array is fine if no data exists.
- Empty arrays are acceptable; placeholder strings or padding-with-news are NEVER acceptable.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 8000, maxSearches: 4 });
}

// Chunk 3b: Conviction watch + opportunity watch — runs in parallel with
// smart_money. Reads on the user's actual positions (conviction) and
// thematic gaps the user doesn't own yet (opportunity).
async function generateConvictionAndOpportunity(
  name: string,
  watchlist: string[],
  holdings: any[],
  date: string
) {
  const ownedSet = new Set((holdings || []).map((h: any) => h.symbol));
  const ownedNote = ownedSet.size > 0 ? `\nUser's holdings: ${Array.from(ownedSet).join(", ")}.` : "";
  const focusTickers = (holdings && holdings.length > 0)
    ? (holdings as any[]).slice(0, 5).map((h: any) => h.symbol)
    : (watchlist || []).slice(0, 5);
  const tickerNote = focusTickers.length > 0
    ? `\nFor conviction_watch, focus on: ${focusTickers.join(", ")}.`
    : "";

  const prompt = `${COMMON_PREAMBLE(name, date)}
Use web_search up to 2 times to fetch the current technical setup, recent catalysts, and thematic news for the focus tickers and adjacent thematic plays.${ownedNote}${tickerNote}

Return ONLY this JSON:

{
  "conviction_watch": [
    {
      "ticker": "TICKER",
      "signal": "add or hold or trim",
      "why_now": "1-2 short sentences, max 25 words",
      "note": "tight summary, max 8 words",
      "action": "OPTIONAL concrete trade with size, max 12 words — omit for routine holds",
      "deep_reasoning": "130-180 word explanation written for someone NEW to trading. Cover: WHY this signal NOW for this stock you own (what's happening that triggered it), WHY YOU MIGHT WANT TO FOLLOW IT (what problem it solves), WHAT TO THINK ABOUT FIRST (your cost basis if known, how much you own as % of portfolio, tax differences between IRA and taxable accounts), WHAT COULD GO WRONG (the case against acting, why doing nothing might be fine). PLAIN ENGLISH RULES: define any technical term in the same sentence (e.g. 'cost basis — what you originally paid'). Never use trading slang without explaining it. Use 'you' and 'your' to make it personal. Like a thoughtful friend explaining over coffee. Full sentences. No bullet points."
    }
  ],
  "opportunity_watch": [
    {
      "ticker": "TICKER (must NOT already be in user's holdings)",
      "theme": "short tag matching user's themes (e.g. 'AI compute', 'Nuclear · grid', 'Quantum hardware', 'Critical minerals', 'Biotech catalyst')",
      "fits_gap": "1-line tagline, max 14 words, on what GAP in their portfolio this fills (e.g. 'Adds AI cooling exposure you're missing')",
      "headline": "1-line catalyst, max 14 words (what's happening today that makes this a watch NOW)",
      "deep_reasoning": "180-220 word personalized buy thesis written for someone NEW to investing. Cover FOUR things: (1) WHY THIS FITS YOUR PORTFOLIO (reference their existing themes/holdings, the gap this fills, why it's not duplicative); (2) THE THESIS (why this stock now — catalyst, valuation, technical setup); (3) SIZING THINKING (suggest a starter position size in plain language — 'a 2-3% position would let you participate without overcommitting'); (4) WHAT COULD GO WRONG (honest bear case, key risks). Define any technical term in the same sentence. Use 'you' and 'your'. Like a thoughtful friend who's seen your portfolio explaining why this idea fits."
    }
  ]
}

conviction_watch: 8-10 entries — TARGET 10. Mix of CLEAR HIGH-CONVICTION takes (add, hold, trim) backed by current setup, catalysts, or risk PLUS thoughtful routine "hold" coverage on the user's other major positions. Every position the user holds at meaningful size deserves SOME take, even if it's "no catalyst today, just hold and let it run" — that's still useful information. Prioritize the user's largest positions and biggest catalysts at the top, fill remaining slots with routine reads on other holdings. EVERY entry MUST include deep_reasoning — this is the depth the user reads when they tap the card. Aim for 10 cards of genuine coverage across the portfolio, NOT 4 hot takes + 6 placeholders.

opportunity_watch: 8-10 portfolio-aware buy ideas. Stock MUST NOT be in user's current holdings. Each pick MUST: (1) match one of the user's existing themes (AI / semis / nuclear / quantum / biotech / critical minerals / crypto infra), (2) fill a thematic gap (different sub-theme than what they already own — e.g. if they own NVDA, suggest cooling/power infrastructure rather than another GPU maker), (3) have a real catalyst or setup TODAY worth watching, (4) include the deep_reasoning paragraph. QUALITY OVER QUANTITY — 8 strong picks beat 10 with filler. If you genuinely can't find 8 high-conviction non-duplicate fits, return whatever you have. This is the most actionable section of the brief — users are deciding what to BUY based on this, so filler is dangerous.

PRIMARY DECISION INPUT: This brief is the user's main source for "what to do with what I own" — hold, add, or trim signals. Filler hurts trust. Aim for 8-10 strong calls; if a position is genuinely "no view, just hold," it's fine to omit and return fewer.

CRITICAL DATA RULES:
- NEVER use placeholder strings like "DATA_UNAVAILABLE", "N/A", "NONE", "UNKNOWN", "TBD", or any all-caps placeholder.
- Empty arrays are acceptable; placeholder strings are NEVER acceptable.`;

  return callJsonChunk(prompt, { search: true, maxTokens: 12000, maxSearches: 3 });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatHoldingsBlock(
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null
) {
  if (!holdings || holdings.length === 0) return "";
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
    const label = accountId === "_unknown"
      ? "Unlabeled holdings"
      : (accountLabel[accountId] || "Account");
    groupBlocks.push(`  Account: ${label}\n${list.map(formatHolding).join("\n")}`);
  }
  const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7
    ? ` (${holdingsAgeDays} days old — % gains approximate)`
    : "";
  return `\n\nUSER'S HOLDINGS${ageNote}:\n${groupBlocks.join("\n\n")}\n`;
}

// Old single-call buildPrompt kept below as a reference but no longer used.
function buildPrompt(
  name: string,
  watchlist: string[],
  holdings: any[],
  accounts: any[] | undefined,
  holdingsAgeDays: number | null,
  date: string
) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";

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
      ? ` (NOTE: Holdings data is ${holdingsAgeDays} days old; treat % gains as approximate.)`
      : "";
    const accountCount = Object.keys(groups).length;
    const accountNote = accountCount > 1
      ? ` The user holds these positions across ${accountCount} accounts. When writing playbook items, ALWAYS name the specific account (e.g., "Trim NVDA in Fidelity TOD: 30 of 75 sh").`
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

3. mindset.fuel must be a structured 4-block 10-MINUTE VITALITY ROUTINE for someone fit and capable, no equipment needed. The 4 blocks are mobility, breathwork, strength, and cooldown. Each block has its own specific moves with reps/duration, plus a 'why' sentence. Vary the specific exercises each day so the user stays engaged. Use plain English — define any technical term in the same sentence (e.g. 'box breath — 4 seconds in, 4 hold, 4 out, 4 hold').

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

   c. whale_moves: 3-5 entries — institutional 13F filings from major investors (Berkshire, Bridgewater, Pershing Square, Tepper Appaloosa, Druckenmiller Duquesne, Soros, Tudor Jones, Howard Marks Oaktree, etc.). QUALITY OVER QUANTITY: better 3 real trades than 5 padded with filler.
   d. congress_moves: 3-5 entries — STOCK Act disclosures from named members of Congress (Pelosi, Tuberville, Crenshaw, Greene, Whitehouse, Khanna, etc.). EVERY entry must be a SPECIFIC TRADE by a NAMED person — not "ten members hold X" or "GOP delayed vote" or any other news/political headlines. If you can't find 5 real trades, return fewer.
   e. hedge_fund_moves: 3-5 entries — fund-level rotations distinct from the whales above. Use names like Citadel, Renaissance, Two Sigma, Millennium, Coatue, D.E. Shaw, Point72, Tiger Global, Lone Pine. EVERY entry must be a SPECIFIC TRADE — not "Bridgewater 13F due" or "Tiger Global holds X exposure" (vague), and not filing schedules.

   ABSOLUTE BAD EXAMPLES — these patterns must NEVER appear in any of the 3 categories:
   * News commentary: "Violations continue despite STOCK Act 45-day rule"
   * Calendar notes: "Bridgewater Q1 13F due mid-May"
   * Vague exposure summaries: "Tiger Global holds US China India exposure"
   * Political headlines: "GOP leadership delayed floor vote past Q1"
   * Generic crowd statements: "Ten members hold $750k-$2M crypto exposure"
   Each row MUST be: [Named person/fund] + [bought/sold/added/trimmed] + [specific ticker] + [size or date if known].

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

   CRITICAL TICKER ACCURACY: When you reference a ticker, NEVER guess what company it is. If you're not 100% sure of the company name behind a ticker, write ONLY the ticker symbol (e.g. "SMMT" not "SMMT (Summit Materials)"). Common confusable tickers to be careful about: SMMT is Summit Therapeutics (biotech), NOT Summit Materials. CIFR is Cipher Mining (crypto miner), NOT Cipher Pharmaceuticals. APLD is Applied Digital, NOT Applied Materials. USAR is USA Rare Earth, NOT some other USA-prefixed name. SMR is NuScale, IREN is Iris Energy. When in doubt, leave the company name out — the ticker alone is sufficient and accurate.

   ${holdings && holdings.length > 0 ? `When holdings are provided, EVERY decision must reference a SPECIFIC ticker the user holds, with their actual share count and gain/loss when known, plus a SPECIFIC action with reasoning. Cite real catalysts (earnings dates, ex-div dates, FOMC, CPI) when relevant.` : `When holdings are NOT provided, reference watchlist tickers and known market catalysts. Encourage user to upload their CSV for fully personalized recommendations.`}

   GOOD examples (personalized, specific):
   • "IONQ +45% on 175 sh — earnings 5/6. Trim 75 into Friday strength, keep 100."
   • "NVDA reports tonight. You hold 75 sh. Set $850 stop, no add pre-FOMC."
   • "VRT 35sh down 8% — bottom forming. Add ½ unit if $112 holds support."
   • "MSFT +12% past month. Trim 10 of 40 sh into earnings strength."
   • "OKLO 100 sh up sharply on nuclear thesis. Hold core, trail stop $43."

   BAD examples to AVOID (generic, work for anyone):
   • "Review highest-conviction position." (which one? what to do?)
   • "Confirm cash balance." (this is a checklist task, not analysis)
   • "Pre-decide exits before catalysts." (what catalysts? which positions?)
   • "Trim winners into strength." (which winners? how much?)
   • "Practice gratitude." (not a trade decision)

   For each decision, the format should be: [Ticker context] + [Specific action] + [Reasoning/catalyst]. Maximum 14 words per item to keep it scannable.

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
    "whale_moves": [ { "text": "named trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this firm or person and WHY are they worth watching (their AUM, track record, strategy in plain language) — WHAT EXACTLY did they do (the trade size, when, and what it likely signals about their conviction) — WHY THIS MATTERS for someone watching the markets today — WHAT TO BE CAREFUL OF (data delays, that this is a snapshot, that smart money makes mistakes too). Define any technical term in the same sentence." } ],
    "congress_moves": [ { "text": "named congressional trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this Congress member and WHY their trades draw attention (their committee assignments, what info they have access to, their disclosed track record) — WHAT EXACTLY they traded (size, when filed, when actually executed) — THE STOCK ACT context (30-45 day disclosure delay, what that means for retail investors trying to follow) — WHY THIS particular trade is interesting (timing relative to legislation, sector context, scale relative to their net worth). Define any technical term in the same sentence." } ],
    "hedge_fund_moves": [ { "text": "named hedge fund trade, max 12 words", "ticker": "TICKER", "source_url": "https://...", "why_matters": "80-120 word plain-English explanation written for someone NEW to investing. Cover: WHO is this hedge fund and HOW they operate (assets under management, investment style — quant/macro/long-short/activist — explain each style in plain language if used) — WHAT THIS TRADE represents in the context of their portfolio (a major rotation, a new theme, a hedge) — WHY THIS FUND IS WORTH WATCHING (track record, public-facing analysts, notable past calls) — KEY CAVEATS (13F shows positions only, not derivatives or shorts, ~45 day delay). Define any technical term in the same sentence." } ]
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
    "description": "2-3 sentences (50-75 words) describing the dish — flavor, texture, why it satisfies",
    "why_this_meal": "70-100 word plain-English paragraph on why this meal fits today: protein, fats, fiber, anti-inflammatory rationale tied to the day's mood",
    "groceries": ["6-9 specific grocery items with rough quantities"],
    "prep_steps": ["6-8 beginner-friendly cooking steps, max 22 words each"],
    "swap_options": ["2-3 simple substitutions"],
    "pairing": "1-line beverage or side suggestion"
  },
  "decisions": ["8-10 PERSONALIZED trader actions referencing user's actual holdings + today's catalysts, max 14 words each"]
}`;
}
