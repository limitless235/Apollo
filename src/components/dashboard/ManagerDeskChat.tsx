"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ChatCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function ManagerDeskChat({
  selectedSymbol,
  pendingPrompt,
  onPendingPromptConsumed,
}: {
  selectedSymbol: string;
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    []
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage({ text: trimmed });
  };

  useEffect(() => {
    if (!pendingPrompt?.trim() || isLoading) return;
    void submit(pendingPrompt).then(() => onPendingPromptConsumed?.());
  }, [pendingPrompt, isLoading, onPendingPromptConsumed]);

  return (
    <Card className="flex h-full min-h-[320px] flex-col border-white/[0.08] bg-white/[0.02]">
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <ChatCircle size={16} className="text-indigo-400" />
          <CardTitle className="text-sm">Manager&apos;s Desk</CardTitle>
        </div>
        <p className="text-[11px] text-white/40">
          Personal BUY/HOLD/SELL opinions — stocks, watchlist &amp; portfolio
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-xs leading-relaxed text-white/40">
              Ask e.g. &quot;Should I buy {selectedSymbol}?&quot; or &quot;Analyze my portfolio&quot;
              — uses live signals, holdings, and news tools.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "rounded-lg px-3 py-2 text-xs leading-relaxed",
                message.role === "user"
                  ? "ml-8 bg-indigo-500/15 text-white/85"
                  : "mr-4 bg-white/[0.04] text-white/75"
              )}
            >
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/30">
                {message.role === "user" ? "You" : "Apollo"}
              </p>
              <p className="whitespace-pre-wrap">{messageText(message)}</p>
            </div>
          ))}
          {isLoading && (
            <p className="text-xs text-white/35">Thinking… (fetching signals &amp; news)</p>
          )}
          {error && (
            <p className="text-xs text-rose-300/80">
              {error.message.includes("API key") || error.message.includes("Gemini")
                ? "Chat unavailable — set GOOGLE_GENERATIVE_AI_API_KEY in .env.local and restart dev server."
                : error.message.includes("quota") || error.message.includes("Quota")
                  ? "Gemini quota exceeded — check ai.dev/rate-limit or set GEMINI_MODEL=gemini-2.5-flash-lite in .env.local."
                  : error.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 justify-start text-[11px] text-indigo-300/90"
            disabled={isLoading}
            onClick={() =>
              void submit(
                `Analyze my full portfolio using analyzePortfolio. Summarize health, trim/hold/add names, concentration risk, and one rebalance idea.`
              )
            }
          >
            Analyze my portfolio
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 justify-start text-[11px] text-indigo-300/90"
            disabled={isLoading}
            onClick={() =>
              void submit(
                `Should I buy, hold, or sell ${selectedSymbol}? Use getTradeRecommendation and explain in plain English with verdict, why, and risks.`
              )
            }
          >
            Analyze {selectedSymbol}
          </Button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about any NSE stock…"
            disabled={isLoading}
            className="text-sm"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <PaperPlaneTilt size={16} />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
