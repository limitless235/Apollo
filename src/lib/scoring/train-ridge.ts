import type { RawFeatures } from "./features";
import type { RankerModel } from "./ranker-model";
import { getActiveRankerFeatureKeys } from "./feature-vector";
import {
  runWalkForwardValidation,
  buildModelFromWalkForward,
} from "./walk-forward";

export interface TrainingSample {
  date: string;
  symbol: string;
  features: RawFeatures;
  nextReturn: number;
}

export function trainRidgeRanker(
  samples: TrainingSample[],
  options: {
    holdoutRatio?: number;
    ridgeLambda?: number;
    tuneLambda?: boolean;
    useRecencyWeights?: boolean;
    forwardDays?: number;
    targetType?: "excess" | "rank";
    nFolds?: number;
    featureKeys?: readonly string[];
    logFolds?: boolean;
  } = {}
): RankerModel | null {
  const forwardDays = options.forwardDays ?? 5;
  const targetType = options.targetType ?? "rank";
  const featureKeys = options.featureKeys ?? getActiveRankerFeatureKeys();

  if (samples.length < 80) return null;

  const wf = runWalkForwardValidation(samples, {
    nFolds: options.nFolds ?? 6,
    testDays: 60,
    tuneLambda: options.tuneLambda ?? true,
    useRecencyWeights: options.useRecencyWeights ?? true,
    forwardDays,
    targetType,
    ridgeLambda: options.ridgeLambda,
    featureKeys,
    logFolds: options.logFolds ?? true,
  });

  if (!wf) return null;
  return buildModelFromWalkForward(samples, wf, forwardDays, targetType, featureKeys);
}

export { getActiveRankerFeatureKeys as RANKER_FEATURE_KEYS };
