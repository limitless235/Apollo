import type { RawFeatures } from "./features";

/** Features used by the learned ranker (tabular, no price level). */
export const RANKER_FEATURE_KEYS = [
  "momentum5d",
  "momentum20d",
  "return1d",
  "volatility20d",
  "volumeZScore",
  "avgSentiment7d",
  "sentimentDelta",
  "newsCount7d",
  "newsVolumeZ",
  "sentimentMlCoverage",
] as const;

export type RankerFeatureKey = (typeof RANKER_FEATURE_KEYS)[number];

export function featuresToVector(features: RawFeatures): number[] {
  return [
    features.momentum5d,
    features.momentum20d,
    features.return1d,
    features.volatility20d,
    features.volumeZScore,
    features.avgSentiment7d,
    features.sentimentDelta,
    Math.log1p(features.newsCount7d),
    features.newsVolumeZ,
    features.sentimentMlCoverage,
  ];
}

export function standardizeVector(
  vector: number[],
  means: number[],
  stds: number[]
): number[] {
  return vector.map((v, i) => {
    const sd = stds[i] || 1;
    return sd > 1e-8 ? (v - means[i]) / sd : 0;
  });
}

export function computeFeatureStats(rows: number[][]): {
  means: number[];
  stds: number[];
} {
  const p = rows[0]?.length ?? 0;
  const means = new Array<number>(p).fill(0);
  const stds = new Array<number>(p).fill(1);

  if (rows.length === 0) return { means, stds };

  for (let j = 0; j < p; j++) {
    means[j] = rows.reduce((s, r) => s + r[j], 0) / rows.length;
  }
  for (let j = 0; j < p; j++) {
    const variance =
      rows.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) /
      Math.max(rows.length - 1, 1);
    stds[j] = Math.sqrt(variance) || 1;
  }

  return { means, stds };
}

/** Map predicted next-day return (%) to composite-compatible score. */
export function returnToScore(predictedReturnPct: number): number {
  return Math.tanh(predictedReturnPct / 2.5);
}
