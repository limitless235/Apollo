import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { agentTools } from "@/lib/agent/tools";
import { initDb } from "@/lib/db";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Apollo's Manager's Desk — a personal investment assistant for Indian equities (NSE/BSE). This is for the user's private, personal portfolio only.

You MAY and SHOULD give clear personal trade opinions: BUY, HOLD, SELL, or AVOID when asked. Base them on Apollo data (signals, news, sentiment, momentum, backtest IC/DA, rank).

Workflow when asked about a stock:
1. resolveSymbol if needed
2. getTradeRecommendation (primary) or getSymbolSignal + getNewsSentiment + getPriceContext
3. fetchCompanyNews for fresh headlines if article count is low
4. Deliver a direct verdict first, then reasons and risks in plain English

Opinion format:
- **Verdict:** BUY | HOLD | SELL | AVOID (match getTradeRecommendation when available)
- **Confidence:** low / medium / high
- **Why:** 2–4 bullets from signal breakdown, momentum, sentiment, rank
- **Risks:** what could invalidate the view
- **What I'd do:** one sentence personal action (starter buy, trim, wait, etc.)

Be skeptical of parabolic moves (+80% in 90d, +35% in 20d) with no news. Mention when data is thin (0 articles). Use backtest IC/DA as historical context, not a guarantee.

Portfolio workflow when asked about the user's holdings or "my portfolio":
1. analyzePortfolio (primary) — includes value, P&L, weights, signals, recommendations
2. getPortfolio if they only need the raw holdings list
3. For each major holding, mention weight % and whether to trim, hold, or add
4. Flag concentration risk if any position is >25% of portfolio
5. Note mutual funds without live NAV (priceSource cost/unavailable)

Portfolio opinion format:
- **Portfolio health:** brief overall read (diversified / concentrated / weak signals)
- **Trim candidates:** SELL/AVOID names with reasons
- **Hold core:** stable positions worth keeping
- **Add / accumulate:** BUY-rated names already owned or worth adding
- **Rebalance:** one practical suggestion if weights are skewed

End with: "Personal use — your sizing and timing."`;

function getGeminiApiKey(): string | undefined {
  const explicit =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY;
  if (explicit?.trim()) return explicit.trim();

  // Legacy: Gemini keys (AIza…) sometimes pasted into the old Anthropic slot
  const legacy = process.env.ANTHROPIC_API_KEY?.trim();
  if (legacy?.startsWith("AIza")) return legacy;

  return undefined;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

export async function POST(req: Request) {
  initDb();

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "Gemini API key not configured. Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { messages } = await req.json();

  const gemini = createGoogleGenerativeAI({ apiKey });

  const result = streamText({
    model: gemini(getGeminiModel()),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: agentTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("API key") ||
        msg.includes("API_KEY") ||
        msg.includes("401") ||
        msg.includes("403")
      ) {
        return "Invalid Gemini API key. Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local (from Google AI Studio), then restart npm run dev.";
      }
      if (msg.includes("quota") || msg.includes("Quota exceeded")) {
        return "Gemini quota exceeded. Check usage at https://ai.dev/rate-limit or try GEMINI_MODEL=gemini-2.5-flash-lite in .env.local, then restart npm run dev.";
      }
      return msg || "Chat request failed.";
    },
  });
}
