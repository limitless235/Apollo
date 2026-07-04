import fs from "fs";
import path from "path";
import type { RawFeatures } from "./features";
import {
  RANKER_FEATURE_KEYS,
  featuresToVector,
  standardizeVector,
  returnToScore,
} from "./feature-vector";
import { crossSectionalZScoreRows } from "./cross-sectional";
import { computeBlendWeight } from "./score-blend";
import type { IcSignificance } from "./ic-stats";

export interface RankerMetrics {
  ic: number;
  pooledIc?: number;
  directionalAccuracy: number;
  mae: number;
  samples: number;
}

export interface WalkForwardFoldSummary {
  fold: number;
  testStart: string;
  testEnd: string;
  meanIC: number;
  icIR: number;
  tStat: number;
  nDays: number;
}

export interface RankerModel {
  version: 1 | 2 | 3;
  type: "ridge-linear";
  crossSectional?: boolean;
  forwardDays?: number;
  targetType?: "excess" | "rank";
  featureNames: readonly string[];
  means: number[];
  stds: number[];
  weights: number[];
  bias: number;
  ridgeLambda: number;
  trainedAt: string;
  sampleCount: number;
  trainMetrics: RankerMetrics;
  holdoutMetrics: RankerMetrics;
  /** Walk-forward-derived ML weight in [0, 1] for rank-transform blending. */
  mlWeight?: number;
  heuristicWeight?: number;
  heuristicIC?: number;
  mlIC?: number;
  icSignificance?: IcSignificance;
  walkForwardFolds?: WalkForwardFoldSummary[];
}

const DEFAULT_MODEL_PATH = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "ranker-model.json");

let cachedModel: RankerModel | null | undefined;

export function getRankerModelPath(): string {
  return process.env.RANKER_MODEL_PATH ?? DEFAULT_MODEL_PATH;
}

export function loadRankerModel(force = false): RankerModel | null {
  if (!force && cachedModel !== undefined) return cachedModel;

  const modelPath = getRankerModelPath();
  if (!fs.existsSync(modelPath)) {
    cachedModel = null;
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(modelPath, "utf-8")) as RankerModel;
    if (raw.type !== "ridge-linear") {
      cachedModel = null;
      return null;
    }
    cachedModel = raw;
    return raw;
  } catch {
    cachedModel = null;
    return null;
  }
}

export function saveRankerModel(model: RankerModel, filePath?: string): void {
  const target = filePath ?? getRankerModelPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(model, null, 2));
  cachedModel = model;
}

export function predictReturn(features: RawFeatures, model: RankerModel): number {
  return predictReturnsBatch([features], model)[0];
}

/**
 * Inference normalization: cross-sectional z-score blended with training std
 * when watchlist is small, avoiding a cliff at n=5.
 */
export function normalizeForInference(
  rawFeatures: number[][],
  trainingMeans: number[],
  trainingStds: number[]
): number[][] {
  const n = rawFeatures.length;
  if (n === 0) return [];

  const csz = n > 1 ? crossSectionalZScoreRows(rawFeatures) : null;
  const csWeight = n > 1 ? Math.min(1, n / 5) : 0;

  return rawFeatures.map((row, i) =>
    row.map((val, j) => {
      const trainStd = standardizeVector([val], trainingMeans, trainingStds)[0];
      if (!csz) return trainStd;
      return csWeight * csz[i][j] + (1 - csWeight) * trainStd;
    })
  );
}

function toModelVectors(
  featuresList: RawFeatures[],
  model: RankerModel
): number[][] {
  const raw = featuresList.map((f) => featuresToVector(f, model.featureNames));
  const normalized =
    model.crossSectional
      ? normalizeForInference(raw, model.means, model.stds)
      : raw.map((v) => standardizeVector(v, model.means, model.stds));
  return normalized;
}

function scoreScale(model: RankerModel): {
  version: number;
  forwardDays?: number;
  targetType?: "excess" | "rank";
} {
  return {
    version: model.version,
    forwardDays: model.forwardDays,
    targetType: model.targetType,
  };
}

function modelFeatureDim(model: RankerModel): number {
  return model.weights.length;
}

export function predictReturnsBatch(
  featuresList: RawFeatures[],
  model: RankerModel
): number[] {
  const expectedDim = modelFeatureDim(model);
  const vectors = toModelVectors(featuresList, model);
  return vectors.map((vector) => {
    if (vector.length !== expectedDim) return 0;
    let sum = model.bias;
    for (let i = 0; i < vector.length; i++) {
      sum += vector[i] * model.weights[i];
    }
    return sum;
  });
}

export function predictRankerScoresBatch(
  featuresList: RawFeatures[],
  model: RankerModel | null
): (number | null)[] {
  if (!model || featuresList.length === 0) {
    return featuresList.map(() => null);
  }
  const scale = scoreScale(model);
  const expectedDim = modelFeatureDim(model);
  const currentDim = featuresToVector(featuresList[0], model.featureNames).length;
  if (currentDim !== expectedDim) {
    return featuresList.map(() => null);
  }
  return predictReturnsBatch(featuresList, model).map((r) =>
    returnToScore(r, scale)
  );
}

export function predictRankerScore(
  features: RawFeatures,
  model: RankerModel | null
): number | null {
  if (!model) return null;
  return returnToScore(predictReturn(features, model), scoreScale(model));
}

export function getRankerBlend(): number {
  const raw = Number(process.env.RANKER_BLEND ?? "0.25");
  if (Number.isNaN(raw)) return 0.25;
  return Math.max(0, Math.min(1, raw));
}

/** ML weight for rank-transform blending — prefers walk-forward stored weight. */
export function getMlWeight(model: RankerModel | null): number {
  if (!model) return 0;
  if (model.mlWeight != null) return model.mlWeight;
  const hIC = model.heuristicIC ?? 0;
  const mIC = model.mlIC ?? model.holdoutMetrics.ic;
  return computeBlendWeight(hIC, mIC);
}

/** @deprecated use getMlWeight — kept for UI display */
export function getEffectiveRankerBlend(model: RankerModel | null): number {
  return getMlWeight(model);
}

export function blendScores(
  heuristicScore: number,
  learnedScore: number | null,
  blend = getRankerBlend()
): { score: number; learnedScore: number | null; rankerActive: boolean } {
  if (learnedScore == null) {
    return { score: heuristicScore, learnedScore: null, rankerActive: false };
  }
  return {
    score: (1 - blend) * heuristicScore + blend * learnedScore,
    learnedScore,
    rankerActive: true,
  };
}

export { RANKER_FEATURE_KEYS };
