"use client";

export interface RankerStatusInfo {
  active: boolean;
  crossSectional?: boolean;
  version?: number | null;
  trainedAt?: string | null;
  sampleCount?: number;
  holdoutIc?: number | null;
  holdoutDa?: number | null;
  effectiveBlend?: number | null;
  blend?: number | null;
  ridgeLambda?: number | null;
  icIR?: number | null;
  icTStat?: number | null;
}

export function RankerHeaderHint({ ranker }: { ranker: RankerStatusInfo | null }) {
  if (!ranker?.active) return null;

  const parts: string[] = ["ML ranker"];
  if (ranker.version != null) parts[0] = `ML v${ranker.version}`;
  if (ranker.forwardDays) parts.push(`${ranker.forwardDays}d`);
  if (ranker.crossSectional) parts.push("CS");
  if (ranker.effectiveBlend != null) {
    parts.push(`${(ranker.effectiveBlend * 100).toFixed(0)}% blend`);
  }
  if (ranker.holdoutIc != null) {
    parts.push(`IC ${ranker.holdoutIc.toFixed(3)}`);
  }
  if (ranker.icTStat != null) {
    parts.push(`t=${ranker.icTStat.toFixed(1)}`);
  }

  return <span className="text-emerald-400/70"> · {parts.join(" · ")}</span>;
}

export function RankerInactiveBanner({ ranker }: { ranker: RankerStatusInfo | null }) {
  if (ranker?.active) return null;

  return (
    <div className="mx-4 mb-0 mt-0 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200/80 lg:mx-6">
      ML ranker not loaded — watchlist uses heuristic scoring only. Train locally:{" "}
      <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px] text-amber-100/90">
        npm run train:ranker
      </code>
    </div>
  );
}
