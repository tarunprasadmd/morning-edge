// /api/chat — interactive chat about a specific card from today's brief.
//
// The user taps "Ask about this" on any card (Playbook decision, Conviction
// Watch entry, Radar item, Insider Flow row), which opens a chat sheet
// pre-loaded with the card's context. Their question + conversation history
// flows here. Claude responds with full awareness of:
//   - The specific card they're asking about
//   - Their portfolio (holdings + cash balance, if synced)
//   - Today's market pulse (so we know the day's tone)
//
// Stays small and focused — no web search, ~800 max tokens per response,
// concise answers. Uses Sonnet 4 for nuance + speed.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CardContext {
  type: "playbook" | "conviction" | "radar" | "insider" | "general";
  // Free-form text describing the card — built by the frontend so we don't
  // have to know every card schema here. The frontend serializes the
  // ticker/action/reasoning/etc. into a coherent paragraph.
  description: string;
  ticker?: string;
}

interface ChatBody {
  messages: ChatMessage[];
  cardContext: CardContext | null;
  portfolio?: {
    holdings?: Array<{ symbol: string; qty?: number; value?: number; gainPct?: number }>;
    cashBalance?: number;
  };
  briefSummary?: {
    tone?: string;
    summary?: string;
    date?: string;
  };
  userName?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatBody;
    const { messages, cardContext, portfolio, briefSummary, userName } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    // Build the system prompt with all the context Claude needs to give
    // a genuinely useful, personalized answer.
    const systemPrompt = buildSystemPrompt({
      cardContext,
      portfolio,
      briefSummary,
      userName,
    });

    // Trim message history to last ~20 turns to keep costs sane on long
    // conversations. Keep the most recent.
    const trimmedMessages = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: systemPrompt,
      messages: trimmedMessages,
    });

    const responseText = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");

    return NextResponse.json({
      reply: responseText,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err: any) {
    console.error("Chat error:", err);
    return NextResponse.json(
      { error: err?.message || "Chat failed" },
      { status: 500 }
    );
  }
}

function buildSystemPrompt(ctx: {
  cardContext: CardContext | null;
  portfolio?: ChatBody["portfolio"];
  briefSummary?: ChatBody["briefSummary"];
  userName?: string;
}): string {
  const { cardContext, portfolio, briefSummary, userName } = ctx;

  let prompt = `You are Morning Edge, an AI investing copilot built into the user's daily brief app. You help the user think through specific recommendations from their brief — by giving direct, useful, personalized analysis.

CRITICAL TONE:
- Be direct and concise. Phone-screen length responses. 2-4 short paragraphs max for normal questions.
- Talk like a thoughtful friend who happens to know markets, not a corporate assistant.
- Plain English. Avoid jargon unless explaining it.
- When the user asks how many shares they can buy, do the math and tell them.
- When the user is unsure about timing, give them a framework, not a prediction.
- Acknowledge uncertainty honestly. Don't pretend you know what the market will do.

CRITICAL HONESTY RULES:
- Never invent specific prices, dates, or numbers. If you don't know the current price of a stock, say "depends on current price — check your broker" rather than guessing.
- Never give absolute "buy" or "sell" instructions. Frame everything as "here's how I'd think about it" — the user makes the decision.
- If the user's question requires data you don't have (real-time price, latest news, their full portfolio), say so plainly.
- This is informational, not financial advice. Mention this once if the user asks for absolute direction; don't repeat constantly.

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
      const gainStr = h.gainPct ? ` (${h.gainPct > 0 ? "+" : ""}${h.gainPct.toFixed(1)}%)` : "";
      prompt += `\n  - ${h.symbol} — ${qtyStr} ${valStr}${gainStr}`;
    }
  } else {
    prompt += `\n\nUser's portfolio: not synced. If they ask about position sizing or "how many shares can I buy," ask them to share their cash balance and you'll do the math.`;
  }

  if (cardContext) {
    prompt += `\n\nThe user is asking about this specific item from their brief:
[${cardContext.type.toUpperCase()}${cardContext.ticker ? ` · ${cardContext.ticker}` : ""}]
${cardContext.description}

Their questions will likely be about this item. Stay focused on it unless they explicitly change the topic.`;
  }

  prompt += `\n\nKeep responses concise. Start with the answer, then briefly explain. End by inviting a follow-up if helpful.`;

  return prompt;
}
