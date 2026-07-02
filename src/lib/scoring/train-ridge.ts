import type { RawFeatures } from "./features";
import {
  featuresToVector,
  standardizeVector,
  computeFeatureStats,
} from "./feature-vector";
import type { RankerMetrics, RankerModel } from "./ranker-model";
import { RANKER_FEATURE_KEYS } from "./ranker-model";
import {
  averageDailyIc,
  prepareCrossSectionalSamples,
  recencyWeights,
  spearman,
} from "./cross-sectional";

export interface TrainingSample {
  date: string;
  symbol: string;
  features: RawFeatures;
  nextReturn: number;
}

function evaluatePredictions(
  predicted: number[],
  actual: number[],
  dated: Array<{ date: string; predicted: number; actual: number }>
): RankerMetrics {
  const mae =
    predicted.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) /
    Math.max(predicted.length, 1);

  let correct = 0;
  let directional = 0;
  for (let i = 0; i < predicted.length; i++) {
    if (Math.abs(predicted[i]) < 0.02 && Math.abs(actual[i]) < 0.05) continue;
    if (predicted[i] > 0.02 || predicted[i] < -0.02) {
      directional++;
      const predUp = predicted[i] > 0;
      const actUp = actual[i] > 0;
      if (predUp === actUp) correct++;
    }
  }

  return {
    ic: averageDailyIc(dated),
    pooledIc: spearman(predicted, actual),
    directionalAccuracy: directional > 0 ? correct / directional : 0,
    mae,
    samples: predicted.length,
  };
}

/** Weighted ridge: (X'WX + λI)w = X'Wy */
function fitRidge(
  X: number[][],
  y: number[],
  lambda: number,
  sampleWeights?: number[]
): { weights: number[]; bias: number } {
  const n = X.length;
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);

  for (let i = 0; i < n; i++) {
    const w = sampleWeights?.[i] ?? 1;
    for (let j = 0; j < p; j++) {
      Xty[j] += w * X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += w * X[i][j] * X[i][k];
      }
    }
  }

  for (let j = 0; j < p; j++) XtX[j][j] += lambda;

  const weights = solveSymmetric(XtX, Xty);
  return { weights, bias: 0 };
}

function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const div = M[col][col] || 1e-12;
    for (let j = col; j <= n; j++) M[col][j] /= div;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row[n]);
}

function predictBatch(
  X: number[][],
  weights: number[],
  bias: number
): number[] {
  return X.map((row) => row.reduce((s, v, i) => s + v * weights[i], bias));
}

const LAMBDA_GRID = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8];

function trainAndEvaluateSplit(
  trainPrepared: ReturnType<typeof prepareCrossSectionalSamples>,
  holdoutPrepared: ReturnType<typeof prepareCrossSectionalSamples>,
  ridgeLambda: number,
  useRecencyWeights: boolean
): { weights: number[]; bias: number; means: number[]; stds: number[]; trainMetrics: RankerMetrics; holdoutMetrics: RankerMetrics } {
  const rawTrain = trainPrepared.map((s) => s.vector);
  const { means, stds } = computeFeatureStats(rawTrain);

  const Xtrain = rawTrain.map((v) => standardizeVector(v, means, stds));
  const yTrain = trainPrepared.map((s) => s.target);
  const weights = useRecencyWeights
    ? recencyWeights(trainPrepared.map((s) => s.date))
    : undefined;

  const { weights: w, bias } = fitRidge(Xtrain, yTrain, ridgeLambda, weights);

  const trainPred = predictBatch(Xtrain, w, bias);
  const trainDated = trainPrepared.map((s, i) => ({
    date: s.date,
    predicted: trainPred[i],
    actual: s.target,
  }));
  const trainMetrics = evaluatePredictions(
    trainPred,
    yTrain,
    trainDated
  );

  const Xhold = holdoutPrepared.map((s) =>
    standardizeVector(s.vector, means, stds)
  );
  const yHold = holdoutPrepared.map((s) => s.target);
  const holdPred = predictBatch(Xhold, w, bias);
  const holdDated = holdoutPrepared.map((s, i) => ({
    date: s.date,
    predicted: holdPred[i],
    actual: s.target,
  }));
  const holdoutMetrics = evaluatePredictions(holdPred, yHold, holdDated);

  return {
    weights: w,
    bias,
    means,
    stds,
    trainMetrics,
    holdoutMetrics,
  };
}

export function trainRidgeRanker(
  samples: TrainingSample[],
  options: {
    holdoutRatio?: number;
    ridgeLambda?: number;
    tuneLambda?: boolean;
    useRecencyWeights?: boolean;
  } = {}
): RankerModel | null {
  const holdoutRatio = options.holdoutRatio ?? 0.25;
  const tuneLambda = options.tuneLambda ?? true;
  const useRecencyWeights = options.useRecencyWeights ?? true;

  if (samples.length < 80) return null;

  const prepared = prepareCrossSectionalSamples(samples);
  if (prepared.length < 80) return null;

  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();
  const splitDateIdx = Math.floor(uniqueDates.length * (1 - holdoutRatio));
  const splitDate = uniqueDates[Math.max(splitDateIdx, 1)] ?? uniqueDates[0];

  const trainPrepared = prepared.filter((s) => s.date < splitDate);
  const holdoutPrepared = prepared.filter((s) => s.date >= splitDate);

  if (trainPrepared.length < 60 || holdoutPrepared.length < 20) return null;

  let bestLambda = options.ridgeLambda ?? 1.5;
  let bestHoldoutIc = -Infinity;
  let bestResult = trainAndEvaluateSplit(
    trainPrepared,
    holdoutPrepared,
    bestLambda,
    useRecencyWeights
  );

  if (tuneLambda) {
    for (const lambda of LAMBDA_GRID) {
      const result = trainAndEvaluateSplit(
        trainPrepared,
        holdoutPrepared,
        lambda,
        useRecencyWeights
      );
      if (result.holdoutMetrics.ic > bestHoldoutIc) {
        bestHoldoutIc = result.holdoutMetrics.ic;
        bestLambda = lambda;
        bestResult = result;
      }
    }
  }

  return {
    version: 2,
    type: "ridge-linear",
    crossSectional: true,
    featureNames: RANKER_FEATURE_KEYS,
    means: bestResult.means,
    stds: bestResult.stds,
    weights: bestResult.weights,
    bias: bestResult.bias,
    ridgeLambda: bestLambda,
    trainedAt: new Date().toISOString(),
    sampleCount: prepared.length,
    trainMetrics: bestResult.trainMetrics,
    holdoutMetrics: bestResult.holdoutMetrics,
  };
}
