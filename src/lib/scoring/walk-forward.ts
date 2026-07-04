import type { TrainingSample } from "./train-ridge";
import {
  prepareCrossSectionalSamples,
  recencyWeights,
  type PreparedSample,
} from "./cross-sectional";
import {
  standardizeVector,
  computeFeatureStats,
  getActiveRankerFeatureKeys,
} from "./feature-vector";
import type { RankerModel, RankerMetrics } from "./ranker-model";
import {
  dailyIcSeries,
  evaluateDatedPredictions,
  icSignificance,
  type WalkForwardFoldMetrics,
  type IcSignificance,
} from "./ic-stats";
import { computeBlendWeight } from "./score-blend";
import {
  trainEndWithLabelPurge,
  dailyIcStd,
  printWalkForwardFoldTable,
  logFoldConstruction,
  countSignFlips,
} from "./walk-forward-logging";

const LAMBDA_GRID = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 12];

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
  return { weights: solveSymmetric(XtX, Xty), bias: 0 };
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

function predictBatch(X: number[][], weights: number[], bias: number): number[] {
  return X.map((row) => row.reduce((s, v, i) => s + v * weights[i], bias));
}

/** Ridge predictions on a holdout split using train-fitted standardization. */
export function predictHoldoutTest(
  testPrepared: PreparedSample[],
  holdout: Pick<HoldoutEvalResult, "weights" | "bias" | "means" | "stds">
): number[] {
  const Xtest = testPrepared.map((s) => standardizeVector(s.vector, holdout.means, holdout.stds));
  return predictBatch(Xtest, holdout.weights, holdout.bias);
}

/** Standardization stats fit on train rows only; applied to train and test. */
function trainFold(
  trainPrepared: PreparedSample[],
  testPrepared: PreparedSample[],
  ridgeLambda: number,
  useRecencyWeights: boolean
) {
  const rawTrain = trainPrepared.map((s) => s.vector);
  const { means, stds } = computeFeatureStats(rawTrain);
  const Xtrain = rawTrain.map((v) => standardizeVector(v, means, stds));
  const yTrain = trainPrepared.map((s) => s.target);
  const sampleWeights = useRecencyWeights
    ? recencyWeights(trainPrepared.map((s) => s.date)).map((w, i) => {
        const absTarget = Math.abs(yTrain[i]);
        return w * (0.5 + 0.5 * Math.min(absTarget, 1));
      })
    : undefined;

  const { weights, bias } = fitRidge(Xtrain, yTrain, ridgeLambda, sampleWeights);
  const Xtest = testPrepared.map((s) => standardizeVector(s.vector, means, stds));
  const holdPred = predictBatch(Xtest, weights, bias);
  const holdDated = testPrepared.map((s, i) => ({
    date: s.date,
    predicted: holdPred[i],
    actual: s.target,
  }));

  return {
    weights,
    bias,
    means,
    stds,
    stdFitTrainRows: trainPrepared.length,
    stdFitTestRows: testPrepared.length,
    eval: evaluateDatedPredictions(holdDated),
  };
}

export interface HoldoutEvalResult {
  bestLambda: number;
  weights: number[];
  bias: number;
  means: number[];
  stds: number[];
  stdFitTrainRows: number;
  stdFitTestRows: number;
  eval: ReturnType<typeof evaluateDatedPredictions>;
}

/** Train on one split, evaluate on holdout — same path walk-forward folds use. */
export function evaluateHoldoutSplit(
  trainPrepared: PreparedSample[],
  testPrepared: PreparedSample[],
  options: {
    ridgeLambda?: number;
    tuneLambda?: boolean;
    useRecencyWeights?: boolean;
  } = {}
): HoldoutEvalResult {
  const tuneLambda = options.tuneLambda ?? true;
  const useRecencyWeights = options.useRecencyWeights ?? true;
  let bestLambda = options.ridgeLambda ?? 1.5;
  let best = trainFold(trainPrepared, testPrepared, bestLambda, useRecencyWeights);

  if (tuneLambda) {
    for (const lambda of LAMBDA_GRID) {
      const result = trainFold(trainPrepared, testPrepared, lambda, useRecencyWeights);
      if (result.eval.ic > best.eval.ic) {
        best = result;
        bestLambda = lambda;
      }
    }
  }

  return { bestLambda, ...best };
}

export interface WalkForwardOptions {
  nFolds?: number;
  testDays?: number;
  minTrainDays?: number;
  ridgeLambda?: number;
  tuneLambda?: boolean;
  useRecencyWeights?: boolean;
  forwardDays?: number;
  targetType?: "excess" | "rank";
  featureKeys?: readonly string[];
  /** Print per-fold table to stdout (default true). */
  logFolds?: boolean;
}

export interface WalkForwardResult {
  folds: WalkForwardFoldMetrics[];
  aggregateSignificance: IcSignificance;
  signFlips: number;
  bestLambda: number;
  finalWeights: number[];
  finalBias: number;
  finalMeans: number[];
  finalStds: number[];
  heuristicIC: number;
  mlIC: number;
  mlWeight: number;
  heuristicWeight: number;
  /** First OOS test date across all folds. */
  oosTestStart: string;
  oosTestEnd: string;
}

export function runWalkForwardValidation(
  samples: TrainingSample[],
  options: WalkForwardOptions = {}
): WalkForwardResult | null {
  const nFolds = options.nFolds ?? 6;
  const testDays = options.testDays ?? 60;
  const minTrainDays = options.minTrainDays ?? 120;
  const forwardDays = options.forwardDays ?? 5;
  const tuneLambda = options.tuneLambda ?? true;
  const useRecencyWeights = options.useRecencyWeights ?? true;
  const targetType = options.targetType ?? "rank";
  const featureKeys = options.featureKeys ?? getActiveRankerFeatureKeys();
  const logFolds = options.logFolds ?? false;

  // Samples sorted by date; label prep is per-date CS z-score (same-day only — not leakage).
  const prepared = prepareCrossSectionalSamples(samples, { targetType, featureKeys });
  if (prepared.length < 200) return null;

  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();
  if (uniqueDates.length < minTrainDays + testDays + forwardDays) return null;

  const folds: WalkForwardFoldMetrics[] = [];
  const totalTestSpan = nFolds * testDays;
  const startIdx = Math.max(minTrainDays, uniqueDates.length - totalTestSpan);

  for (let f = 0; f < nFolds; f++) {
    const testStartIdx = startIdx + f * testDays;
    const testEndIdx = Math.min(testStartIdx + testDays, uniqueDates.length);
    if (testStartIdx >= uniqueDates.length) break;

    const purge = trainEndWithLabelPurge(uniqueDates, testStartIdx, forwardDays);
    if (!purge) continue;

    const testStart = uniqueDates[testStartIdx];
    const testEnd = uniqueDates[testEndIdx - 1];
    const trainStart = uniqueDates[0];
    const trainEnd = purge.trainEnd;
    const gapDays = purge.gapDays;

    const trainDays = purge.trainEndIdx + 1;
    const testDayCount = testEndIdx - testStartIdx;

    const trainPrepared = prepared.filter((s) => s.date <= trainEnd);
    const testPrepared = prepared.filter(
      (s) => s.date >= testStart && s.date <= testEnd
    );
    if (trainPrepared.length < 60 || testPrepared.length < 20) continue;

    if (logFolds) {
      logFoldConstruction(
        f + 1,
        trainStart,
        trainEnd,
        trainDays,
        testStart,
        testEnd,
        testDayCount,
        gapDays
      );
    }

    let bestLambda = options.ridgeLambda ?? 1.5;
    let bestEval = trainFold(trainPrepared, testPrepared, bestLambda, useRecencyWeights).eval;

    if (tuneLambda) {
      for (const lambda of LAMBDA_GRID) {
        const result = trainFold(trainPrepared, testPrepared, lambda, useRecencyWeights);
        if (result.eval.ic > bestEval.ic) {
          bestEval = result.eval;
          bestLambda = lambda;
        }
      }
    }

    const bestFold = trainFold(trainPrepared, testPrepared, bestLambda, useRecencyWeights);

    if (logFolds) {
      console.log(
        `     fold ${f + 1}: standardization fit on train rows only (n=${bestFold.stdFitTrainRows}), applied to test rows (n=${bestFold.stdFitTestRows})`
      );
    }

    folds.push({
      fold: f + 1,
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      trainDays,
      testDays: testDayCount,
      gapDays,
      trainSamples: trainPrepared.length,
      testSamples: testPrepared.length,
      stdFitTrainRows: bestFold.stdFitTrainRows,
      stdFitTestRows: bestFold.stdFitTestRows,
      bestLambda,
      dailyICs: bestFold.eval.dailyICs,
      dailyIcStd: dailyIcStd(bestFold.eval.dailyICs),
      significance: bestFold.eval.significance,
    });
  }

  if (folds.length === 0) return null;

  const allDailyICs = folds.flatMap((f) => f.dailyICs);
  const aggregateSignificance = icSignificance(allDailyICs);
  const mlIC = aggregateSignificance.meanIC;

  const foldMeanIcs = folds.map((f) => f.significance.meanIC);
  const signFlips = countSignFlips(foldMeanIcs);
  if (logFolds) {
    printWalkForwardFoldTable(folds, aggregateSignificance);
  }

  const heuristicIC = estimateHeuristicIC(
    prepared,
    uniqueDates.slice(startIdx)
  );

  const mlWeight = computeBlendWeight(heuristicIC, mlIC);

  const lambdas = folds.map((fold) => fold.bestLambda);
  const medianLambda = lambdas.sort((a, b) => a - b)[Math.floor(lambdas.length / 2)] ?? 8;

  const rawAll = prepared.map((s) => s.vector);
  const { means, stds } = computeFeatureStats(rawAll);
  const Xall = rawAll.map((v) => standardizeVector(v, means, stds));
  const yAll = prepared.map((s) => s.target);
  const weights = useRecencyWeights
    ? recencyWeights(prepared.map((s) => s.date)).map((w, i) => {
        const absTarget = Math.abs(yAll[i]);
        return w * (0.5 + 0.5 * Math.min(absTarget, 1));
      })
    : undefined;
  const final = fitRidge(Xall, yAll, medianLambda, weights);

  return {
    folds,
    aggregateSignificance,
    signFlips,
    bestLambda: medianLambda,
    finalWeights: final.weights,
    finalBias: final.bias,
    finalMeans: means,
    finalStds: stds,
    heuristicIC,
    mlIC,
    mlWeight,
    heuristicWeight: 1 - mlWeight,
    oosTestStart: folds[0].testStart,
    oosTestEnd: folds[folds.length - 1].testEnd,
  };
}

/** Rough heuristic IC from momentum20d rank vs forward return on test dates. */
function estimateHeuristicIC(prepared: PreparedSample[], testDates: string[]): number {
  const testSet = new Set(testDates);
  const dated: Array<{ date: string; predicted: number; actual: number }> = [];

  for (const s of prepared) {
    if (!testSet.has(s.date)) continue;
    dated.push({ date: s.date, predicted: s.vector[1] ?? 0, actual: s.target });
  }

  return icSignificance(dailyIcSeries(dated)).meanIC;
}

/** Single 75/25 holdout with label-purge gap before test (matches walk-forward hygiene). */
export function runSingleHoldoutEval(
  prepared: PreparedSample[],
  uniqueDates: string[],
  options: {
    holdoutRatio?: number;
    forwardDays?: number;
    tuneLambda?: boolean;
    ridgeLambda?: number;
    /** Restrict test rows to dates >= testStartMin (for apples-to-apples with WF OOS window). */
    testStartMin?: string;
    testEndMax?: string;
  } = {}
): {
  splitDate: string;
  trainEnd: string;
  gapDays: number;
  trainRows: number;
  testRows: number;
  result: HoldoutEvalResult;
} | null {
  const holdoutRatio = options.holdoutRatio ?? 0.25;
  const forwardDays = options.forwardDays ?? 5;

  let dates = uniqueDates;
  if (options.testStartMin) {
    dates = dates.filter((d) => d >= options.testStartMin!);
  }
  if (options.testEndMax) {
    dates = dates.filter((d) => d <= options.testEndMax!);
  }

  const splitIdx = Math.floor(dates.length * (1 - holdoutRatio));
  if (splitIdx <= forwardDays || splitIdx >= dates.length) return null;

  const testStart = dates[splitIdx];
  const testStartGlobalIdx = uniqueDates.indexOf(testStart);
  const purge = trainEndWithLabelPurge(uniqueDates, testStartGlobalIdx, forwardDays);
  if (!purge) return null;

  const trainPrepared = prepared.filter((s) => s.date <= purge.trainEnd);
  let testPrepared = prepared.filter((s) => s.date >= testStart);
  if (options.testEndMax) {
    testPrepared = testPrepared.filter((s) => s.date <= options.testEndMax!);
  }

  if (trainPrepared.length < 60 || testPrepared.length < 20) return null;

  const result = evaluateHoldoutSplit(trainPrepared, testPrepared, {
    tuneLambda: options.tuneLambda ?? true,
    ridgeLambda: options.ridgeLambda,
  });

  return {
    splitDate: testStart,
    trainEnd: purge.trainEnd,
    gapDays: purge.gapDays,
    trainRows: trainPrepared.length,
    testRows: testPrepared.length,
    result,
  };
}

export function buildModelFromWalkForward(
  samples: TrainingSample[],
  wf: WalkForwardResult,
  forwardDays: number,
  targetType: "excess" | "rank",
  featureKeys: readonly string[] = getActiveRankerFeatureKeys()
): RankerModel {
  const prepared = prepareCrossSectionalSamples(samples, { targetType, featureKeys });
  const rawAll = prepared.map((s) => s.vector);
  const Xall = rawAll.map((v) => standardizeVector(v, wf.finalMeans, wf.finalStds));
  const yAll = prepared.map((s) => s.target);
  const allPred = predictBatch(Xall, wf.finalWeights, wf.finalBias);
  const allDated = prepared.map((s, i) => ({
    date: s.date,
    predicted: allPred[i],
    actual: yAll[i],
  }));
  const trainEval = evaluateDatedPredictions(allDated);

  const holdoutEval: RankerMetrics = {
    ic: wf.aggregateSignificance.meanIC,
    pooledIc: wf.aggregateSignificance.meanIC,
    directionalAccuracy: 0.5,
    mae: 0,
    samples: wf.folds.reduce((s, f) => s + f.testSamples, 0),
  };

  return {
    version: 3,
    type: "ridge-linear",
    crossSectional: true,
    forwardDays,
    targetType,
    featureNames: featureKeys,
    means: wf.finalMeans,
    stds: wf.finalStds,
    weights: wf.finalWeights,
    bias: wf.finalBias,
    ridgeLambda: wf.bestLambda,
    trainedAt: new Date().toISOString(),
    sampleCount: prepared.length,
    mlWeight: wf.mlWeight,
    heuristicWeight: wf.heuristicWeight,
    walkForwardFolds: wf.folds.map((f) => ({
      fold: f.fold,
      testStart: f.testStart,
      testEnd: f.testEnd,
      meanIC: f.significance.meanIC,
      icIR: f.significance.icIR,
      tStat: f.significance.tStat,
      nDays: f.significance.nDays,
    })),
    icSignificance: wf.aggregateSignificance,
    heuristicIC: wf.heuristicIC,
    mlIC: wf.mlIC,
    trainMetrics: {
      ic: trainEval.ic,
      pooledIc: trainEval.pooledIc,
      directionalAccuracy: 0.5,
      mae: 0,
      samples: prepared.length,
    },
    holdoutMetrics: holdoutEval,
  };
}

export { printWalkForwardFoldTable, foldMetricsToTableRow } from "./walk-forward-logging";
