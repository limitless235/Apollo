import type { TrainingSample } from "./train-ridge";
import { prepareCrossSectionalSamples } from "./cross-sectional";
import { trainEndWithLabelPurge } from "./walk-forward-logging";
import { dailyIcSeries, icSignificance } from "./ic-stats";
import { spearman, MIN_CROSS_SECTION } from "./cross-sectional";
import { dailyIcStd } from "./walk-forward-logging";
import { evaluateAcceptanceBar, type AcceptanceBarResult } from "./acceptance-bar";
import type { RawFeatures } from "./features";

const FORWARD_DAYS = 5;

export interface SubsetFoldRow {
  fold: number;
  testStart: string;
  testEnd: string;
  nTestDays: number;
  nTestRows: number;
  nQualifyingDays: number;
  lowDayCountWarning: boolean;
  meanIC: number;
  dailyIcStd: number;
}

export interface SubsetEvalResult {
  subsetName: string;
  folds: SubsetFoldRow[];
  aggregate: ReturnType<typeof icSignificance>;
  acceptance: AcceptanceBarResult;
  foldMeanIcs: number[];
}

export interface SubsetEvalOptions {
  nFolds?: number;
  testDays?: number;
  minTrainDays?: number;
  forwardDays?: number;
  /** Filter test rows — return true to include in this subset's IC. */
  rowFilter: (features: RawFeatures) => boolean;
  /** Standalone score: rank prediction from a single feature (or custom). */
  predictScore: (features: RawFeatures) => number | null;
  subsetName: string;
  minQualifyingDays?: number;
}

function rankTargetForDay(returns: number[]): number[] {
  const n = returns.length;
  if (n < 2) return returns.map(() => 0);
  const order = returns.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r);
  const ranks = new Array<number>(n);
  order.forEach((item, rank) => {
    ranks[item.i] = rank;
  });
  return ranks.map((rank) => (2 * rank) / (n - 1) - 1);
}

/**
 * Subset-first walk-forward IC: same fold boundaries as main harness,
 * but scores rows with a standalone feature predictor on filtered subset.
 */
export function runSubsetWalkForwardEval(
  samples: TrainingSample[],
  options: SubsetEvalOptions
): SubsetEvalResult | null {
  const nFolds = options.nFolds ?? 6;
  const testDays = options.testDays ?? 60;
  const minTrainDays = options.minTrainDays ?? 120;
  const forwardDays = options.forwardDays ?? FORWARD_DAYS;
  const minQualifyingDays = options.minQualifyingDays ?? 15;

  const prepared = prepareCrossSectionalSamples(samples, { targetType: "rank" });
  if (prepared.length < 200) return null;

  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();
  const totalTestSpan = nFolds * testDays;
  const startIdx = Math.max(minTrainDays, uniqueDates.length - totalTestSpan);

  const folds: SubsetFoldRow[] = [];
  const allDailyIcs: number[] = [];

  for (let f = 0; f < nFolds; f++) {
    const testStartIdx = startIdx + f * testDays;
    const testEndIdx = Math.min(testStartIdx + testDays, uniqueDates.length);
    if (testStartIdx >= uniqueDates.length) break;

    const purge = trainEndWithLabelPurge(uniqueDates, testStartIdx, forwardDays);
    if (!purge) continue;

    const testStart = uniqueDates[testStartIdx];
    const testEnd = uniqueDates[testEndIdx - 1];

    const testPrepared = prepared.filter(
      (s) => s.date >= testStart && s.date <= testEnd
    );

    // Map prepared back to raw features via samples
    const sampleByKey = new Map(
      samples.map((s) => [`${s.date}|${s.symbol}`, s])
    );

    const dated: Array<{ date: string; predicted: number; actual: number }> = [];

    for (const row of testPrepared) {
      const raw = sampleByKey.get(`${row.date}|${row.symbol}`);
      if (!raw || !options.rowFilter(raw.features)) continue;

      const score = options.predictScore(raw.features);
      if (score == null || Number.isNaN(score)) continue;

      dated.push({
        date: row.date,
        predicted: score,
        actual: row.target,
      });
    }

    const dailyICs = dailyIcSeries(dated);
    allDailyIcs.push(...dailyICs);

    const testDaySet = new Set(dated.map((d) => d.date));
    const meanIC =
      dailyICs.length > 0
        ? dailyICs.reduce((a, b) => a + b, 0) / dailyICs.length
        : 0;

    folds.push({
      fold: f + 1,
      testStart,
      testEnd,
      nTestDays: testEndIdx - testStartIdx,
      nTestRows: dated.length,
      nQualifyingDays: testDaySet.size,
      lowDayCountWarning: testDaySet.size < minQualifyingDays,
      meanIC,
      dailyIcStd: dailyIcStd(dailyICs),
    });
  }

  if (folds.length === 0) return null;

  const aggregate = icSignificance(allDailyIcs);
  const foldMeanIcs = folds.map((f) => f.meanIC);
  const acceptance = evaluateAcceptanceBar(foldMeanIcs, aggregate);

  return {
    subsetName: options.subsetName,
    folds,
    aggregate,
    acceptance,
    foldMeanIcs,
  };
}

/** Pooled IC using all rows (sanity baseline). */
export function runPooledFeatureIc(
  samples: TrainingSample[],
  predictScore: (features: RawFeatures) => number | null
): number {
  const prepared = prepareCrossSectionalSamples(samples, { targetType: "rank" });
  const sampleByKey = new Map(samples.map((s) => [`${s.date}|${s.symbol}`, s]));
  const dated: Array<{ date: string; predicted: number; actual: number }> = [];

  for (const row of prepared) {
    const raw = sampleByKey.get(`${row.date}|${row.symbol}`);
    if (!raw) continue;
    const score = predictScore(raw.features);
    if (score == null) continue;
    dated.push({ date: row.date, predicted: score, actual: row.target });
  }

  return icSignificance(dailyIcSeries(dated)).meanIC;
}

export function printSubsetFoldTable(result: SubsetEvalResult): void {
  console.log(`\n── ${result.subsetName} ──\n`);
  console.log(
    "fold | test_start  | test_end    | n_days | n_rows | qual_days | warn | mean_IC  | IC_std"
  );
  console.log("-".repeat(88));
  for (const f of result.folds) {
    const warn = f.lowDayCountWarning ? " ⚠" : "";
    console.log(
      `${String(f.fold).padStart(4)} | ${f.testStart} | ${f.testEnd} | ${String(f.nQualifyingDays).padStart(6)} | ${String(f.nTestRows).padStart(6)} | ${String(f.nQualifyingDays).padStart(9)} |${warn.padStart(5)} | ${f.meanIC >= 0 ? "+" : ""}${f.meanIC.toFixed(4).padStart(7)} | ${f.dailyIcStd.toFixed(4)}`
    );
  }
  const a = result.aggregate;
  console.log("-".repeat(88));
  console.log(
    ` ALL | pooled      |             | ${String(a.nDays).padStart(6)} |        |           |      | ${a.meanIC >= 0 ? "+" : ""}${a.meanIC.toFixed(4).padStart(7)} | t=${a.tStat.toFixed(2)} IR=${a.icIR.toFixed(3)}`
  );
  console.log(
    `Sign flips: ${result.acceptance.signFlips} / ${Math.max(result.foldMeanIcs.length - 1, 0)} · Acceptance: ${result.acceptance.pass ? "PASS" : "FAIL"} (${result.acceptance.reasons.join("; ") || "ok"})`
  );
}

export { spearman, MIN_CROSS_SECTION };
