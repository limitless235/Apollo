"use client";

import { cn } from "@/lib/utils";
import type { FeatureContribution, SignalLabel } from "@/lib/scoring/composite";

const LABEL_STYLES: Record<SignalLabel, string> = {
  "Strong Bullish": "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30",
  Bullish: "bg-emerald-500/10 text-emerald-400/90 ring-emerald-500/20",
  Neutral: "bg-amber-500/10 text-amber-300/90 ring-amber-500/20",
  Bearish: "bg-rose-500/10 text-rose-400/90 ring-rose-500/20",
  "Strong Bearish": "bg-rose-500/20 text-rose-300 ring-rose-500/30",
};

export function SignalBadge({
  label,
  score,
  rank,
  compact,
}: {
  label: SignalLabel;
  score: number;
  rank?: number;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {rank != null && (
        <span className="font-mono text-[10px] text-white/35">#{rank}</span>
      )}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
          LABEL_STYLES[label]
        )}
      >
        {compact ? label.replace("Strong ", "") : label}
      </span>
      {!compact && (
        <span className="font-mono text-[10px] text-white/40">
          {score >= 0 ? "+" : ""}
          {score.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function formatRaw(key: string, raw: number): string {
  if (key.includes("momentum")) return `${raw >= 0 ? "+" : ""}${raw.toFixed(1)}%`;
  if (key === "trendStrength")
    return `${raw >= 0 ? "+" : ""}${raw.toFixed(1)}% vs avg`;
  if (key === "volatility20d") return `${raw.toFixed(1)}% ann.`;
  if (key.includes("Sentiment") || key === "sentimentDelta")
    return raw >= 0 ? `+${raw.toFixed(2)}` : raw.toFixed(2);
  if (key === "newsCount7d") return String(Math.round(raw));
  return raw.toFixed(2);
}

/** Cautionary flags get a warning tint so they read as risks, not endorsements. */
const CAUTION_FLAG = /below|spike|downtrend|deteriorat|high volatility/i;
function flagStyle(flag: string): string {
  return CAUTION_FLAG.test(flag)
    ? "bg-amber-500/10 text-amber-300/90 ring-amber-500/20"
    : "bg-indigo-500/10 text-indigo-300/90 ring-indigo-500/20";
}

export function SignalBreakdown({
  breakdown,
  flags,
}: {
  breakdown: FeatureContribution[];
  flags: string[];
}) {
  const sorted = [...breakdown].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sorted.map((item) => (
          <div key={item.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/55">{item.label}</span>
              <span className="font-mono text-white/70">
                {formatRaw(item.key, item.raw)}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn(
                  "absolute top-0 h-full rounded-full transition-all",
                  item.contribution >= 0 ? "bg-emerald-500/70" : "bg-rose-500/70",
                  item.contribution >= 0 ? "left-1/2" : "right-1/2"
                )}
                style={{
                  width: `${Math.min(Math.abs(item.contribution) / 0.25, 1) * 50}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
          {flags.map((flag) => (
            <span
              key={flag}
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] ring-1",
                flagStyle(flag)
              )}
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
