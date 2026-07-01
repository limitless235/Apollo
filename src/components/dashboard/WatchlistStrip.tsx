"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { SentimentPill } from "@/components/dashboard/sentiment-pill";

export interface WatchlistCard {
  symbol: string;
  companyName: string;
  changePercent: number;
  avgSentiment: number;
  newsCount: number;
}

export function WatchlistStrip({
  items,
  selected,
  onSelect,
  onRemove,
}: {
  items: WatchlistCard[];
  selected: string;
  onSelect: (symbol: string) => void;
  onRemove?: (symbol: string) => void;
}) {
  const [parent] = useAutoAnimate();

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[hsl(222,47%,4%)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[hsl(222,47%,4%)] to-transparent" />
      <div
        ref={parent}
        className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((item) => (
          <div
            key={item.symbol}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item.symbol)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(item.symbol);
              }
            }}
            className={cn(
              "group relative flex min-w-[132px] shrink-0 cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 transition-all",
              selected === item.symbol
                ? "border-indigo-500/50 bg-indigo-500/[0.08]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
            )}
          >
            {onRemove && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.symbol);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onRemove(item.symbol);
                  }
                }}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/60 group-hover:flex"
                aria-label={`Remove ${item.symbol}`}
              >
                ×
              </span>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-white">{item.symbol}</span>
              <NumberTicker value={item.changePercent} suffix="%" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <SentimentPill score={item.avgSentiment} />
              {item.newsCount > 0 && (
                <span className="text-[10px] text-white/35">{item.newsCount} news</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
