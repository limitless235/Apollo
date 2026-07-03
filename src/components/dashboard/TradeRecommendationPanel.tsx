"use client";

import { cn } from "@/lib/utils";
import type { TradeAction } from "@/lib/scoring/recommendation";

const ACTION_STYLES: Record<TradeAction, string> = {
  BUY: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  HOLD: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  SELL: "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  AVOID: "bg-orange-500/15 text-orange-200 ring-orange-500/35",
};

export function TradeRecommendationPanel({
  recommendation,
}: {
  recommendation: {
    action: TradeAction;
    confidence: "low" | "medium" | "high";
    headline: string;
    summary: string;
    reasons: string[];
    risks: string[];
    narrative: string;
  };
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-bold tracking-wide ring-1",
            ACTION_STYLES[recommendation.action]
          )}
        >
          {recommendation.action}
        </span>
        <span className="text-[11px] text-white/40 capitalize">
          {recommendation.confidence} confidence · personal use
        </span>
      </div>
      <p className="text-sm text-white/80">{recommendation.summary}</p>
      <p className="text-[13px] leading-relaxed text-white/60">{recommendation.narrative}</p>
      {recommendation.reasons.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/35">
            Why
          </p>
          <ul className="space-y-0.5 text-xs text-white/55">
            {recommendation.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}
      {recommendation.risks.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/35">
            Risks
          </p>
          <ul className="space-y-0.5 text-xs text-rose-200/70">
            {recommendation.risks.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
