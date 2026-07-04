import type { RawFeatures } from "./features";
import type { RankerModel } from "./ranker-model";
import { predictRankerScoresBatch, getMlWeight } from "./ranker-model";
import { blendRankScores, getScoringMode } from "./score-blend";
import {
  applyOverlay,
  isEarningsOverlayEnabled,
  loadEarningsOverlay,
  nearEarningsRowFilter,
  shrinkageFactor,
} from "./earnings-overlay";

export interface FeatureContribution {
  key: string;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
}

export interface SymbolSignal {
  symbol: string;
  companyName: string;
  score: number;
  heuristicScore: number;
  learnedScore: number | null;
  rankerActive: boolean;
  rank: number;
  label: SignalLabel;
  flags: string[];
  features: RawFeatures;
  breakdown: FeatureContribution[];
  changePercent: number;
}

export type SignalLabel = "Strong Bullish" | "Bullish" | "Neutral" | "Bearish" | "Strong Bearish";

const WEIGHTS = {
  momentum20d: 0.18,
  momentum5d: 0.1,
  avgSentiment7d: 0.2,
  sentimentDelta: 0.1,
  newsVolumeZ: 0.12,
  volumeZScore: 0.1,
  volatility20d: -0.1,
  trendStrength: 0.17,
} as const;

function tanhScale(value: number, scale: number): number {
  if (scale === 0) return 0;
  return Math.tanh(value / scale);
}

function normalizeFeature(key: keyof typeof WEIGHTS, raw: number): number {
  switch (key) {
    case "momentum20d":
      return tanhScale(raw, 12);
    case "momentum5d":
      return tanhScale(raw, 6);
    case "avgSentiment7d":
      return Math.max(-1, Math.min(1, raw));
    case "sentimentDelta":
      return tanhScale(raw, 0.4);
    case "newsVolumeZ":
      return tanhScale(raw, 2);
    case "volumeZScore":
      return tanhScale(raw, 2.5);
    case "volatility20d":
      return tanhScale(raw, 35);
    case "trendStrength":
      return tanhScale(raw, 10);
    default:
      return 0;
  }
}

/**
 * How much of the recent 5d move came from a single day. Returns a multiplier in
 * [SPIKE_FLOOR, 1] applied to momentum contributions so one-day spikes need
 * multi-day confirmation before they can top the ranking.
 */
const SPIKE_FLOOR = 0.55;
function spikeDampener(return1d: number, momentum5d: number): number {
  const mag = Math.abs(momentum5d);
  if (mag < 0.5) return 1;
  // Only dampen when today's move is in the same direction as the 5d trend (i.e. inflating it).
  if (Math.sign(return1d) !== Math.sign(momentum5d)) return 1;
  const share = Math.min(1, Math.abs(return1d) / mag);
  if (share <= 0.5) return 1;
  // share 0.5 -> 1.0, share 1.0 -> SPIKE_FLOOR
  return Math.max(SPIKE_FLOOR, 1 - (share - 0.5) * (1 - SPIKE_FLOOR) * 2);
}

const FEATURE_LABELS: Record<keyof typeof WEIGHTS, string> = {
  momentum20d: "20d momentum",
  momentum5d: "5d momentum",
  avgSentiment7d: "7d sentiment",
  sentimentDelta: "Sentiment shift",
  newsVolumeZ: "News activity",
  volumeZScore: "Volume surge",
  volatility20d: "Volatility",
  trendStrength: "Long-term trend",
};

export function scoreFeatures(features: RawFeatures): {
  score: number;
  breakdown: FeatureContribution[];
  flags: string[];
} {
  const breakdown: FeatureContribution[] = [];
  let score = 0;
  const sentimentTrust = 0.55 + 0.45 * features.sentimentMlCoverage;
  const spikeMult = spikeDampener(features.return1d, features.momentum5d);

  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    let raw = features[key];
    if (key === "avgSentiment7d" || key === "sentimentDelta") {
      raw *= sentimentTrust;
    }
    const normalized = normalizeFeature(key, raw);
    const weight = WEIGHTS[key];
    // Require multi-day confirmation: a single-day spike counts for less.
    const dampen = key === "momentum5d" || key === "momentum20d" ? spikeMult : 1;
    const contribution = normalized * weight * dampen;
    score += contribution;

    breakdown.push({
      key,
      label: FEATURE_LABELS[key],
      raw,
      normalized,
      weight,
      contribution,
    });
  }

  const flags: string[] = [];

  if (spikeMult < 0.85) {
    flags.push("Single-day spike (unconfirmed)");
  }

  if (features.trendStrength <= -3) {
    flags.push("Below long-term trend");
  } else if (features.trendStrength >= 3) {
    flags.push("Above long-term trend");
  }

  if (features.sentimentMlCoverage >= 0.75) {
    flags.push("FinBERT-scored news");
  }

  if (features.newsVolumeZ >= 1.5) {
    flags.push(
      features.avgSentiment7d >= 0.15
        ? "News spike (bullish)"
        : features.avgSentiment7d <= -0.15
          ? "News spike (bearish)"
          : "News spike"
    );
  }

  if (features.volumeZScore >= 1.5 && features.momentum5d > 0) {
    flags.push("Volume confirms uptrend");
  }

  if (features.volumeZScore >= 1.5 && features.momentum5d < 0) {
    flags.push("Volume confirms downtrend");
  }

  if (features.volatility20d >= 40) {
    flags.push("High volatility");
  }

  if (Math.abs(features.sentimentDelta) >= 0.25) {
    flags.push(
      features.sentimentDelta > 0 ? "Sentiment improving" : "Sentiment deteriorating"
    );
  }

  if (nearEarningsRowFilter(features)) {
    flags.push("Recent earnings reaction");
  }

  return { score, breakdown, flags };
}

export function signalLabel(score: number): SignalLabel {
  if (score >= 0.25) return "Strong Bullish";
  if (score >= 0.08) return "Bullish";
  if (score <= -0.25) return "Strong Bearish";
  if (score <= -0.08) return "Bearish";
  return "Neutral";
}

export function rankSignals(
  items: Array<{
    symbol: string;
    companyName: string;
    features: RawFeatures;
    changePercent?: number;
  }>,
  rankerModel: RankerModel | null = null
): SymbolSignal[] {
  const learnedScores = predictRankerScoresBatch(
    items.map((item) => item.features),
    rankerModel
  );
  const mlWeight = getMlWeight(rankerModel);
  const scoringMode = getScoringMode();

  const featureScores = items.map((item) => scoreFeatures(item.features));
  const heuristicScores = featureScores.map((f) => f.score);
  const blendedScores = blendRankScores(
    heuristicScores,
    learnedScores,
    mlWeight,
    scoringMode
  );

  const overlay =
    isEarningsOverlayEnabled() ? loadEarningsOverlay() : null;
  const overlayShrinkage =
    overlay != null
      ? shrinkageFactor(
          overlay.trainedOnRows,
          overlay.shrinkageMinRows,
          overlay.shrinkageFullRows
        )
      : 0;

  const scored = items.map((item, idx) => {
    const { score: heuristicScore, breakdown, flags } = featureScores[idx];
    const learnedScore = learnedScores[idx];
    let finalScore = blendedScores[idx];
    const rankerActive = learnedScore != null && scoringMode !== "heuristic_only";
    const finalFlags = [...flags];
    if (rankerActive) finalFlags.push("ML ranker blended");

    if (overlay && overlayShrinkage > 0 && nearEarningsRowFilter(item.features)) {
      finalScore = applyOverlay(finalScore, item.features, overlay, overlayShrinkage);
    }

    return {
      symbol: item.symbol,
      companyName: item.companyName,
      score: finalScore,
      heuristicScore,
      learnedScore: rankerActive ? learnedScore : null,
      rankerActive,
      rank: 0,
      label: signalLabel(finalScore),
      flags: finalFlags,
      features: item.features,
      breakdown,
      changePercent: item.changePercent ?? 0,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
