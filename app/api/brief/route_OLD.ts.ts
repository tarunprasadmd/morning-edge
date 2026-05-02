import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, watchlist, holdings, holdingsAgeDays, date } = body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const userPrompt = buildPrompt(name, watchlist, holdings, holdingsAgeDays, date);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
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

    return NextResponse.json({ brief });
  } catch (err: any) {
    console.error("Brief generation failed:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}

function buildPrompt(name: string, watchlist: string[], holdings: any[], holdingsAgeDays: number | null, date: string) {
  const tickers = (watchlist && watchlist.length) ? watchlist.join(", ") : "general market";

  // Build a structured holdings block when available
  let holdingsBlock = "";
  if (holdings && holdings.length > 0) {
    const lines = holdings.map((h) => {
      const parts = [`${h.symbol}`];
      if (h.qty != null) parts.push(`${h.qty} sh`);
      if (h.cost != null) parts.push(`@ $${h.cost.toFixed(2)} cost`);
      if (h.value != null) parts.push(`$${h.value.toFixed(0)} value`);
      if (h.gainPct != null) {
        const sign = h.gainPct >= 0 ? "+" : "";
        parts.push(`${sign}${h.gainPct.toFixed(1)}%`);
      }
      return "  • " + parts.join(", ");
    });
    const ageNote = holdingsAgeDays != null && holdingsAgeDays > 7
      ? ` (NOTE: User's holdings data is ${holdingsAgeDays} days old — prices have shifted; treat % gains as approximate.)`
      : "";
    holdingsBlock = `\n\nUSER'S ACTUAL HOLDINGS${ageNote}:\n${lines.join("\n")}\n`;
  }

  return `You are a JSON generator. Output ONLY a single valid JSON object. No prose. No markdown. Start with { and end with }.

Generate a morning briefing for ${name || "the user"}. Today is ${date}. Watchlist: ${tickers}.${holdingsBlock}
USER PROFILE: The reader is an active multi-account swing trader managing a portfolio through earnings cycles, FOMC events, and sector rotations. They blend technical analysis (golden cross, MACD, RSI, ADX) with fundamental catalysts (earnings, Fed decisions, geopolitical risk) and smart-money signals (13F filings, congressional disclosures via STOCK Act, insider Form 4s). They are sophisticated — speak to that level. No beginner advice. No "consider diversifying" or "do your own research" filler. They already know.

You have access to web_search. Use it to fetch the MOST RECENT and HIGHEST-IMPACT data — especially for smart_money (latest 13F disclosures, latest congressional STOCK Act filings, biggest insider Form 4 trades from the past 1-2 weeks), market_pulse (today's premarket movement, today's headlines, today's macro events), and CRITICALLY: any earnings dates, ex-dividend dates, or known catalysts in the next 1-2 weeks for the user's actual holdings. Use up to 5 searches. Prioritize signal over volume.

TONE RULES (critical):

1. mindset.gratitude must be a STIMULATING AFFIRMATION drawn from one of three rotating voices (vary by day):
   • STOIC WARRIOR — Marcus Aurelius / Seneca / Epictetus energy: sharp, decisive, the obstacle is the path, what's in your control vs not, build the character today
   • QUIET POWER — Lao Tzu / Rumi / Thich Nhat Hanh energy: stillness as strength, fire underneath the calm, patience that compounds, the quiet mind that sees what others miss
   • ATHLETE MINDSET — grounded performance language: today is a rep, process over outcome, recovery is part of the work, show up the same on green and red days, long-season thinking
   The line must be DECLARATIVE and ACTIVATING — never soft, never "walk gently," never passive resignation. It gives the reader fire or steadiness — depending on the voice — but always with edge. No religion-specific language. Address the reader by name when natural. Maximum 18 words.

2. mindset.fuel must be a STRUCTURED 10-MINUTE VITALITY ROUTINE for someone fit and capable, no equipment needed. Format exactly as: "10-min vitality routine: [2 min mobility] · [3 min breathwork] · [3 min strength] · [2 min stretch]." Vary the specific exercises each day. Keep each segment under 10 words.

3. smart_money.whale_moves and smart_money.congress_moves must be SPECIFIC NAMED TRADES drawn from public 13F filings, Form 4 insider trades, and STOCK Act congressional disclosures. Each item is an OBJECT with three fields:
   - "text": specific trade with named entity + ticker + size estimate + approximate date when known. Examples: "Berkshire trimmed AAPL ~13% (Q1 13F)", "Pelosi disclosed $1-5M META calls (4/12)", "Pershing Square added 1.2M GOOGL". Avoid vague language like "hedge funds" or "asset managers" — use real fund/politician names.
   - "ticker": the primary ticker mentioned (e.g., "AAPL")
   - "source_url": a public verification URL on a USER-FRIENDLY free site:
     • For 13F / institutional whale moves: prefer https://whalewisdom.com/filer/[fund-slug] or https://stockcircle.com/portfolio/[investor-slug] or https://hedgefollow.com/funds/[Fund+Name]
     • For congressional trades: prefer https://www.capitoltrades.com/politicians/[ID] or https://www.capitoltrades.com/trades or https://www.quiverquant.com/congresstrading/
     • For insider Form 4 trades: prefer http://openinsider.com/screener?s=[TICKER]
     • Avoid SEC EDGAR direct links — too dense for end users
   Prioritize the MOST RECENT, HIGHEST-IMPACT disclosures.

4. decisions (Today's Playbook) is THE MOST IMPORTANT FIELD. It must be PERSONALIZED, ACTIONABLE TRADE RECOMMENDATIONS based on the user's actual holdings and today's catalysts — NOT generic principles or to-do lists. The user does not need to be told to "review their portfolio" — they need to be told WHAT TO DO with their specific positions today.

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

5. affirmation field is the headline at top of brief — short, sharp, max 12 words.

Output exactly:
{
  "affirmation": "short sharp opening line, max 12 words",
  "market_pulse": { "tone": "bullish or cautious or bearish", "summary": "1-2 short sentences", "key_levels": ["3-4 short bullets, max 8 words each"] },
  "smart_money": {
    "whale_moves": [ { "text": "named trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ],
    "congress_moves": [ { "text": "named congressional trade, max 12 words", "ticker": "TICKER", "source_url": "https://..." } ]
  },
  "conviction_watch": [ { "ticker": "TICKER", "signal": "add or hold or trim", "note": "max 6 words" } ],
  "mindset": { "gratitude": "stimulating affirmation in one of three voices, max 18 words", "fuel": "structured 10-min routine in the format described above", "focus": "concrete breath/mental cue, max 10 words" },
  "decisions": ["3-5 PERSONALIZED trader actions referencing user's actual holdings + today's catalysts, max 14 words each"]
}`;
}
