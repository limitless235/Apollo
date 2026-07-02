import type { RawFeatures } from "./features";
import {
  featuresToVector,
  standardizeVector,
  computeFeatureStats,
} from "./feature-vector";
import type { RankerMetrics, RankerModel } from "./ranker-model";
import { RANKER_FEATURE_KEYS } from "./ranker-model";

export interface TrainingSample {
  date: string;
  symbol: string;
  features: RawFeatures;
  nextReturn: number;
}

function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  function ranks(values: number[]) {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const result = new Array<number>(values.length);
    indexed.forEach((item, rank) => {
      result[item.i] = rank + 1;
    });
    return result;
  }
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function evaluatePredictions(
  predicted: number[],
  actual: number[]
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
    ic: spearman(predicted, actual),
    directionalAccuracy: directional > 0 ? correct / directional : 0,
    mae,
    samples: predicted.length,
  };
}

/** Ridge regression: (X'X + λI)w = X'y */
function fitRidge(
  X: number[][],
  y: number[],
  lambda: number
): { weights: number[]; bias: number } {
  const n = X.length;
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
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
  return X.map((row) =>
    row.reduce((s, v, i) => s + v * weights[i], bias)
  );
}

export function trainRidgeRanker(
  samples: TrainingSample[],
  options: { holdoutRatio?: number; ridgeLambda?: number } = {}
): RankerModel | null {
  const holdoutRatio = options.holdoutRatio ?? 0.25;
  const ridgeLambda = options.ridgeLambda ?? 1.0;

  if (samples.length < 80) return null;

  const sorted = [...samples].sort((a, b) => a.date.localeCompare(b.date));
  const splitIdx = Math.floor(sorted.length * (1 - holdoutRatio));
  const trainSet = sorted.slice(0, Math.max(splitIdx, 60));
  const holdoutSet = sorted.slice(splitIdx);

  if (trainSet.length < 60 || holdoutSet.length < 20) return null;

  const rawTrain = trainSet.map((s) => featuresToVector(s.features));
  const { means, stds } = computeFeatureStats(rawTrain);

  const Xtrain = rawTrain.map((v) => standardizeVector(v, means, stds));
  const yTrain = trainSet.map((s) => s.nextReturn);

  const { weights, bias } = fitRidge(Xtrain, yTrain, ridgeLambda);

  const trainPred = predictBatch(Xtrain, weights, bias);
  const trainActual = yTrain;
  const trainMetrics = evaluatePredictions(trainPred, trainActual);

  const Xhold = holdoutSet.map((s) =>
    standardizeVector(featuresToVector(s.features), means, stds)
  );
  const yHold = holdoutSet.map((s) => s.nextReturn);
  const holdPred = predictBatch(Xhold, weights, bias);
  const holdoutMetrics = evaluatePredictions(holdPred, yHold);

  return {
    version: 1,
    type: "ridge-linear",
    featureNames: RANKER_FEATURE_KEYS,
    means,
    stds,
    weights,
    bias,
    ridgeLambda,
    trainedAt: new Date().toISOString(),
    sampleCount: samples.length,
    trainMetrics,
    holdoutMetrics,
  };
}
