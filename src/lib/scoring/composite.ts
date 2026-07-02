import type { RawFeatures } from "./features";
import type { RankerModel } from "./ranker-model";
import { blendScores, predictRankerScoresBatch, getEffectiveRankerBlend } from "./ranker-model";

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
  momentum20d: 0.22,
  momentum5d: 0.13,
  avgSentiment7d: 0.22,
  sentimentDelta: 0.1,
  newsVolumeZ: 0.13,
  volumeZScore: 0.1,
  volatility20d: -0.1,
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
    default:
      return 0;
  }
}

const FEATURE_LABELS: Record<keyof typeof WEIGHTS, string> = {
  momentum20d: "20d momentum",
  momentum5d: "5d momentum",
  avgSentiment7d: "7d sentiment",
  sentimentDelta: "Sentiment shift",
  newsVolumeZ: "News activity",
  volumeZScore: "Volume surge",
  volatility20d: "Volatility",
};

export function scoreFeatures(features: RawFeatures): {
  score: number;
  breakdown: FeatureContribution[];
  flags: string[];
} {
  const breakdown: FeatureContribution[] = [];
  let score = 0;
  const sentimentTrust = 0.55 + 0.45 * features.sentimentMlCoverage;

  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    let raw = features[key];
    if (key === "avgSentiment7d" || key === "sentimentDelta") {
      raw *= sentimentTrust;
    }
    const normalized = normalizeFeature(key, raw);
    const weight = WEIGHTS[key];
    const contribution = normalized * weight;
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
  const blend = getEffectiveRankerBlend(rankerModel);

  const scored = items.map((item, idx) => {
    const { score: heuristicScore, breakdown, flags } = scoreFeatures(item.features);
    const learnedScore = learnedScores[idx];
    const blended = blendScores(heuristicScore, learnedScore, blend);
    const finalFlags = [...flags];
    if (blended.rankerActive) finalFlags.push("ML ranker blended");

    return {
      symbol: item.symbol,
      companyName: item.companyName,
      score: blended.score,
      heuristicScore,
      learnedScore: blended.learnedScore,
      rankerActive: blended.rankerActive,
      rank: 0,
      label: signalLabel(blended.score),
      flags: finalFlags,
      features: item.features,
      breakdown,
      changePercent: item.changePercent ?? 0,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
