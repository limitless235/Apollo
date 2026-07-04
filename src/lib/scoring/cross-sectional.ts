import type { TrainingSample } from "./train-ridge";
import { featuresToVector, getActiveRankerFeatureKeys } from "./feature-vector";

export const MIN_CROSS_SECTION = 5;
export const RETURN_WINSORIZE_PCT = 5;

export function winsorize(value: number, limit = RETURN_WINSORIZE_PCT): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function spearman(x: number[], y: number[]): number {
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

function columnStd(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) || 1;
}

/** Z-score each feature column across a single day's universe. */
export function crossSectionalZScoreRows(rows: number[][]): number[][] {
  if (rows.length < MIN_CROSS_SECTION) return rows.map((r) => [...r]);
  const p = rows[0]?.length ?? 0;
  const result = rows.map((r) => [...r]);
  for (let j = 0; j < p; j++) {
    const col = rows.map((r) => r[j]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = columnStd(col);
    for (let i = 0; i < rows.length; i++) {
      result[i][j] = (rows[i][j] - mean) / sd;
    }
  }
  return result;
}

export interface PreparedSample {
  date: string;
  symbol: string;
  vector: number[];
  target: number;
  rawReturn: number;
}

/** Demean returns within each date and winsorize — aligns training with ranking. */
export function prepareCrossSectionalSamples(
  samples: TrainingSample[],
  options: {
    targetType?: "excess" | "rank";
    featureKeys?: readonly string[];
  } = {}
): PreparedSample[] {
  const targetType = options.targetType ?? "excess";
  const featureKeys = options.featureKeys ?? getActiveRankerFeatureKeys();
  const byDate = new Map<string, TrainingSample[]>();
  for (const s of samples) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }

  const prepared: PreparedSample[] = [];

  for (const [date, daySamples] of byDate) {
    const rawVectors = daySamples.map((s) =>
      featuresToVector(s.features, featureKeys)
    );
    const csVectors =
      daySamples.length >= MIN_CROSS_SECTION
        ? crossSectionalZScoreRows(rawVectors)
        : rawVectors;

    const returns = daySamples.map((s) => s.nextReturn);
    const median =
      [...returns].sort((a, b) => a - b)[Math.floor(returns.length / 2)] ?? 0;

    // Rank targets: map raw forward returns to [-1, 1] within the day's universe.
    const rankTargets =
      targetType === "rank" && returns.length >= 2
        ? rankNormalize(returns)
        : null;

    daySamples.forEach((s, i) => {
      const target =
        rankTargets != null
          ? rankTargets[i]
          : winsorize(s.nextReturn - median);
      prepared.push({
        date: s.date,
        symbol: s.symbol,
        vector: csVectors[i],
        target,
        rawReturn: s.nextReturn,
      });
    });
  }

  return prepared.sort((a, b) => a.date.localeCompare(b.date));
}

/** Convert values to percentile ranks in [-1, 1] (higher value → higher rank). */
export function toRankScore(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);

  const order = values
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r - b.r);

  const ranks = new Array<number>(n);
  order.forEach((item, rank) => {
    ranks[item.i] = rank;
  });

  return ranks.map((rank) => (2 * rank) / (n - 1) - 1);
}

/** @deprecated use toRankScore */
function rankNormalize(returns: number[]): number[] {
  return toRankScore(returns);
}

/** Average daily Spearman IC — the metric that matches portfolio ranking. */
export function averageDailyIc(
  items: Array<{ date: string; predicted: number; actual: number }>
): number {
  const byDate = new Map<string, { predicted: number[]; actual: number[] }>();
  for (const item of items) {
    const bucket = byDate.get(item.date) ?? { predicted: [], actual: [] };
    bucket.predicted.push(item.predicted);
    bucket.actual.push(item.actual);
    byDate.set(item.date, bucket);
  }

  const dailyIcs: number[] = [];
  for (const { predicted, actual } of byDate.values()) {
    if (predicted.length >= MIN_CROSS_SECTION) {
      dailyIcs.push(spearman(predicted, actual));
    }
  }

  if (dailyIcs.length === 0) return 0;
  return dailyIcs.reduce((a, b) => a + b, 0) / dailyIcs.length;
}

export function recencyWeights(dates: string[], halfLifeDays = 90): number[] {
  if (dates.length === 0) return [];
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const maxMs = new Date(maxDate).getTime();
  const ln2 = Math.log(2);

  return dates.map((d) => {
    const ageDays = (maxMs - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-ln2 * Math.max(0, ageDays) / halfLifeDays);
  });
}
