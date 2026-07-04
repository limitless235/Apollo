import type { IcSignificance, WalkForwardFoldMetrics } from "./ic-stats";
import { icSignificance } from "./ic-stats";

/** Trading days between trainEnd and testStart (label-purge buffer). */
export function labelPurgeGapDays(
  uniqueDates: string[],
  trainEnd: string,
  testStart: string
): number {
  const trainIdx = uniqueDates.indexOf(trainEnd);
  const testIdx = uniqueDates.indexOf(testStart);
  if (trainIdx < 0 || testIdx < 0) return -1;
  return testIdx - trainIdx - 1;
}

/** Last train date s.t. 5d forward labels do not reach into testStart. */
export function trainEndWithLabelPurge(
  uniqueDates: string[],
  testStartIdx: number,
  forwardDays: number
): { trainEnd: string; trainEndIdx: number; gapDays: number } | null {
  const trainEndIdx = testStartIdx - forwardDays - 1;
  if (trainEndIdx < 0) return null;
  const testStart = uniqueDates[testStartIdx];
  const trainEnd = uniqueDates[trainEndIdx];
  const gapDays = labelPurgeGapDays(uniqueDates, trainEnd, testStart);
  return { trainEnd, trainEndIdx, gapDays };
}

export function dailyIcStd(dailyICs: number[]): number {
  const n = dailyICs.length;
  if (n < 2) return 0;
  const mean = dailyICs.reduce((a, b) => a + b, 0) / n;
  const variance = dailyICs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

export function countSignFlips(foldMeanIcs: number[]): number {
  if (foldMeanIcs.length < 2) return 0;
  let flips = 0;
  for (let i = 1; i < foldMeanIcs.length; i++) {
    if (
      foldMeanIcs[i] !== 0 &&
      foldMeanIcs[i - 1] !== 0 &&
      Math.sign(foldMeanIcs[i]) !== Math.sign(foldMeanIcs[i - 1])
    ) {
      flips++;
    }
  }
  return flips;
}

export interface FoldTableRow {
  fold: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  n_train_days: number;
  n_test_days: number;
  gap_days: number;
  n_test_rows: number;
  std_fit_train_rows: number;
  std_fit_test_rows: number;
  mean_daily_IC: number;
  daily_IC_std: number;
  best_lambda: number;
}

export function foldMetricsToTableRow(f: WalkForwardFoldMetrics): FoldTableRow {
  return {
    fold: f.fold,
    train_start: f.trainStart,
    train_end: f.trainEnd,
    test_start: f.testStart,
    test_end: f.testEnd,
    n_train_days: f.trainDays,
    n_test_days: f.testDays,
    gap_days: f.gapDays,
    n_test_rows: f.testSamples,
    std_fit_train_rows: f.stdFitTrainRows,
    std_fit_test_rows: f.stdFitTestRows,
    mean_daily_IC: f.significance.meanIC,
    daily_IC_std: f.dailyIcStd,
    best_lambda: f.bestLambda,
  };
}

export function printWalkForwardFoldTable(
  folds: WalkForwardFoldMetrics[],
  aggregate: IcSignificance
): { foldMeanIcs: number[]; signFlips: number } {
  const foldMeanIcs = folds.map((f) => f.significance.meanIC);
  const signFlips = countSignFlips(foldMeanIcs);

  console.log("\n── Walk-forward per-fold table ──\n");
  console.log(
    "fold | train_start | train_end   | test_start  | test_end    | n_test_days | n_test_rows | mean_daily_IC | daily_IC_std | gap | λ"
  );
  console.log(
    "-----|-------------|-------------|-------------|-------------|-------------|-------------|---------------|--------------|-----|---"
  );

  for (const f of folds) {
    const row = foldMetricsToTableRow(f);
    console.log(
      `${String(row.fold).padStart(4)} | ${row.train_start} | ${row.train_end} | ${row.test_start} | ${row.test_end} | ${String(row.n_test_days).padStart(11)} | ${String(row.n_test_rows).padStart(11)} | ${row.mean_daily_IC >= 0 ? "+" : ""}${row.mean_daily_IC.toFixed(4).padStart(12)} | ${row.daily_IC_std.toFixed(4).padStart(12)} | ${String(row.gap_days).padStart(3)} | ${row.best_lambda}`
    );
    console.log(
      `     fold ${f.fold}: standardization fit on train rows only (n=${f.stdFitTrainRows}), applied to test rows (n=${f.stdFitTestRows})`
    );
  }

  console.log("-".repeat(120));
  console.log(
    ` ALL | (pooled OOS) |             |             |             | ${String(aggregate.nDays).padStart(11)} |             | ${aggregate.meanIC >= 0 ? "+" : ""}${aggregate.meanIC.toFixed(4).padStart(12)} | IC IR ${aggregate.icIR.toFixed(4)} | t=${aggregate.tStat.toFixed(2)}`
  );

  console.log("\nFold mean IC summary:");
  console.table(
    foldMeanIcs.map((m, i) => ({
      fold: i + 1,
      meanIC: m.toFixed(4),
    }))
  );
  console.log(`Sign flips across folds: ${signFlips} / ${Math.max(foldMeanIcs.length - 1, 0)}`);

  return { foldMeanIcs, signFlips };
}

export function logFoldConstruction(
  fold: number,
  trainStart: string,
  trainEnd: string,
  trainDays: number,
  testStart: string,
  testEnd: string,
  testDays: number,
  gapDays: number
): void {
  console.log(
    `fold ${fold}: train dates [${trainStart} .. ${trainEnd}] (n=${trainDays} days), test dates [${testStart} .. ${testEnd}] (n=${testDays} days), gap days between train end and test start = ${gapDays}`
  );
}
