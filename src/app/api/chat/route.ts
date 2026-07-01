import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { agentTools } from "@/lib/agent/tools";
import { initDb } from "@/lib/db";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Apollo's Manager's Desk — a personal investment research assistant for Indian equities (NSE/BSE).

Your role is to fetch news, analyze sentiment, and explain context in plain language. You do NOT predict prices or give buy/sell advice.

When asked about a company:
1. Resolve the symbol if needed
2. Fetch fresh news using fetchCompanyNews
3. Check sentiment timeline and price context
4. Summarize key headlines, risks, and catalysts with source links

Be concise, factual, and skeptical of hype. Mention when data is limited.`;

export async function POST(req: Request) {
  initDb();

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { messages } = await req.json();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: agentTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
