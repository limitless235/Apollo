import fs from "fs";
import path from "path";
import type { RawFeatures } from "./features";
import {
  RANKER_FEATURE_KEYS,
  featuresToVector,
  standardizeVector,
  returnToScore,
} from "./feature-vector";

export interface RankerMetrics {
  ic: number;
  directionalAccuracy: number;
  mae: number;
  samples: number;
}

export interface RankerModel {
  version: 1;
  type: "ridge-linear";
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
    if (raw.version !== 1 || raw.type !== "ridge-linear") {
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
  const vector = standardizeVector(
    featuresToVector(features),
    model.means,
    model.stds
  );
  let sum = model.bias;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * model.weights[i];
  }
  return sum;
}

export function predictRankerScore(
  features: RawFeatures,
  model: RankerModel | null
): number | null {
  if (!model) return null;
  return returnToScore(predictReturn(features, model));
}

export function getRankerBlend(): number {
  const raw = Number(process.env.RANKER_BLEND ?? "0.25");
  if (Number.isNaN(raw)) return 0.25;
  return Math.max(0, Math.min(1, raw));
}

/** Reduce ML weight when holdout IC is weak — avoids diluting a working heuristic. */
export function getEffectiveRankerBlend(model: RankerModel | null): number {
  const configured = getRankerBlend();
  if (!model) return 0;
  const ic = model.holdoutMetrics.ic;
  if (ic < 0) return Math.min(configured, 0.2);
  if (ic < 0.03) return Math.min(configured, 0.3);
  return configured;
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
