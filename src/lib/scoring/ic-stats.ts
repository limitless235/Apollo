import { averageDailyIc, spearman } from "./cross-sectional";

export interface IcSignificance {
  meanIC: number;
  icIR: number;
  tStat: number;
  nDays: number;
}

/** Stability and significance of a daily-IC series (independent unit = trading day). */
export function icSignificance(dailyICs: number[]): IcSignificance {
  const n = dailyICs.length;
  if (n === 0) return { meanIC: 0, icIR: 0, tStat: 0, nDays: 0 };

  const meanIC = dailyICs.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { meanIC, icIR: 0, tStat: 0, nDays: 1 };

  const variance =
    dailyICs.reduce((a, b) => a + (b - meanIC) ** 2, 0) / (n - 1);
  const stdIC = Math.sqrt(variance);
  const icIR = stdIC === 0 ? 0 : meanIC / stdIC;
  const tStat = stdIC === 0 ? 0 : meanIC / (stdIC / Math.sqrt(n));

  return { meanIC, icIR, tStat, nDays: n };
}

export interface WalkForwardFoldMetrics {
  fold: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainDays: number;
  testDays: number;
  /** Trading days between trainEnd and testStart (label-purge buffer). */
  gapDays: number;
  trainSamples: number;
  testSamples: number;
  /** Rows used to fit ridge standardization (train only). */
  stdFitTrainRows: number;
  /** Test rows normalized with train-fitted stats. */
  stdFitTestRows: number;
  bestLambda: number;
  dailyICs: number[];
  dailyIcStd: number;
  significance: IcSignificance;
}

/** Collect per-day Spearman IC from dated predictions vs actuals. */
export function dailyIcSeries(
  items: Array<{ date: string; predicted: number; actual: number }>
): number[] {
  const byDate = new Map<string, { predicted: number[]; actual: number[] }>();
  for (const item of items) {
    const bucket = byDate.get(item.date) ?? { predicted: [], actual: [] };
    bucket.predicted.push(item.predicted);
    bucket.actual.push(item.actual);
    byDate.set(item.date, bucket);
  }

  const daily: number[] = [];
  for (const { predicted, actual } of byDate.values()) {
    if (predicted.length >= 5) {
      daily.push(spearman(predicted, actual));
    }
  }
  return daily;
}

export function aggregateIcSignificance(
  folds: WalkForwardFoldMetrics[]
): IcSignificance {
  const allDaily = folds.flatMap((f) => f.dailyICs);
  return icSignificance(allDaily);
}

export function evaluateDatedPredictions(
  dated: Array<{ date: string; predicted: number; actual: number }>
): { ic: number; pooledIc: number; dailyICs: number[]; significance: IcSignificance } {
  const predicted = dated.map((d) => d.predicted);
  const actual = dated.map((d) => d.actual);
  const dailyICs = dailyIcSeries(dated);
  return {
    ic: averageDailyIc(dated),
    pooledIc: spearman(predicted, actual),
    dailyICs,
    significance: icSignificance(dailyICs),
  };
}
