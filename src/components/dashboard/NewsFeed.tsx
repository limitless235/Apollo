"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { sentimentLabel } from "@/lib/utils";

export interface NewsArticle {
  id: number;
  title: string;
  summary: string | null;
  source: string | null;
  publishedAt: string;
  sentimentScore: number;
  sentimentSource?: "rules" | "finbert" | "hybrid";
  url: string;
}

export function NewsFeed({
  articles,
  highlightId,
}: {
  articles: NewsArticle[];
  highlightId?: number;
}) {
  const [parent] = useAutoAnimate();

  if (articles.length === 0) return null;

  return (
    <ScrollArea className="h-[calc(100vh-280px)] min-h-[400px]">
      <div ref={parent} className="space-y-2 pr-2">
        {articles.map((article) => {
          const variant = sentimentLabel(article.sentimentScore);
          return (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              id={`news-${article.id}`}
              className={`group block rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all hover:border-indigo-500/25 hover:bg-white/[0.04] ${
                highlightId === article.id ? "border-indigo-500/40 bg-indigo-500/[0.06]" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <div
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    variant === "bull"
                      ? "bg-emerald-400"
                      : variant === "bear"
                        ? "bg-rose-400"
                        : "bg-slate-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug text-white/85 group-hover:text-white">
                    {article.title}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/35">
                    <span className="truncate">{article.source}</span>
                    <span>·</span>
                    <span className="shrink-0">
                      {new Date(article.publishedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <Badge
                      variant={
                        variant === "bull" ? "bull" : variant === "bear" ? "bear" : "neutral"
                      }
                      className="ml-auto shrink-0 text-[10px]"
                    >
                      {article.sentimentScore.toFixed(2)}
                    </Badge>
                    {article.sentimentSource && article.sentimentSource !== "rules" && (
                      <span className="shrink-0 rounded bg-indigo-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-indigo-300/70">
                        {article.sentimentSource === "finbert" ? "ML" : "hyb"}
                      </span>
                    )}
                    <ArrowSquareOut
                      size={12}
                      className="shrink-0 text-white/20 group-hover:text-indigo-400"
                    />
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </ScrollArea>
  );
}
