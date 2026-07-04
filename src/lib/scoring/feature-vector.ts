import type { RawFeatures } from "./features";

/** Original v3 ranker features (no peer/market-relative). */
export const CORE_RANKER_FEATURE_KEYS = [
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
  "trendStrength",
  "momentumTrendAlign",
  "spikeShare",
] as const;

/** A1: sector / market-relative features (added one group at a time). */
export const RELATIVE_FEATURE_KEYS = [
  "momentum20dVsMarket",
  "trendStrengthVsMarket",
  "momentum20dVsSector",
  "trendStrengthVsSector",
  "volatility20dVsSector",
] as const;

/** A2: earnings-related features (disabled until acceptance). */
export const EARNINGS_FEATURE_KEYS = [
  "daysSinceEarnings",
  "postEarningsReturn3d",
  "earningsDataAvailable",
] as const;

export type FeatureGroup = "core" | "relative" | "earnings";

export const FEATURE_GROUPS: Record<FeatureGroup, readonly string[]> = {
  core: CORE_RANKER_FEATURE_KEYS,
  relative: RELATIVE_FEATURE_KEYS,
  earnings: EARNINGS_FEATURE_KEYS,
};

export function featureKeysForGroups(groups: FeatureGroup[]): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const k of FEATURE_GROUPS[g]) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/** Active keys for production ridge — earnings applied via overlay, not ridge inputs. */
export function getActiveRankerFeatureKeys(): readonly string[] {
  const enableRelative = process.env.ENABLE_RELATIVE_FEATURES === "1";
  const groups: FeatureGroup[] = ["core"];
  if (enableRelative) groups.push("relative");
  return featureKeysForGroups(groups);
}

/** @deprecated use getActiveRankerFeatureKeys — default export for backward compat */
export const RANKER_FEATURE_KEYS = getActiveRankerFeatureKeys();

export type RankerFeatureKey = (typeof CORE_RANKER_FEATURE_KEYS)[number] |
  (typeof RELATIVE_FEATURE_KEYS)[number] |
  (typeof EARNINGS_FEATURE_KEYS)[number];

/** Positive when short- and long-term trends agree; negative when fighting the trend. */
export function momentumTrendAlign(f: RawFeatures): number {
  const m = f.momentum20d;
  const t = f.trendStrength;
  if (Math.abs(m) < 0.01 || Math.abs(t) < 0.01) return 0;
  const mag = Math.min(Math.abs(m), Math.abs(t));
  return Math.sign(m) === Math.sign(t) ? mag : -mag;
}

/** Share of the 5d move attributable to the latest day (0–1). High = unconfirmed spike. */
export function spikeShare(f: RawFeatures): number {
  const mag5 = Math.abs(f.momentum5d);
  if (mag5 < 0.5) return 0;
  if (Math.sign(f.return1d) !== Math.sign(f.momentum5d)) return 0;
  return Math.min(1, Math.abs(f.return1d) / mag5);
}

function featureValue(features: RawFeatures, key: string): number {
  if (key === "momentumTrendAlign") return momentumTrendAlign(features);
  if (key === "spikeShare") return spikeShare(features);
  if (key === "newsCount7d") return Math.log1p(features.newsCount7d);
  const v = features[key as keyof RawFeatures];
  return typeof v === "number" ? v : 0;
}

export function featuresToVector(
  features: RawFeatures,
  keys: readonly string[] = getActiveRankerFeatureKeys()
): number[] {
  return keys.map((key) => featureValue(features, key));
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

export interface ScoreScaleOptions {
  version?: number;
  forwardDays?: number;
  targetType?: "excess" | "rank";
}

/** Map model output to composite-compatible score in [-1, 1]. */
export function returnToScore(
  predicted: number,
  scale?: ScoreScaleOptions
): number {
  if (scale?.targetType === "rank" || scale?.version === 3) {
    return Math.max(-1, Math.min(1, predicted));
  }
  const horizon = scale?.forwardDays ?? 1;
  return Math.tanh(predicted / (2.5 * Math.sqrt(horizon)));
}
