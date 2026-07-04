import fs from "fs";
import path from "path";
import type { TrainingSample } from "./train-ridge";
import type { RawFeatures } from "./features";
import { prepareCrossSectionalSamples, type PreparedSample } from "./cross-sectional";
import { CORE_RANKER_FEATURE_KEYS } from "./feature-vector";
import { evaluateHoldoutSplit, predictHoldoutTest } from "./walk-forward";
import { trainEndWithLabelPurge } from "./walk-forward-logging";
import { dailyIcSeries, icSignificance, type IcSignificance } from "./ic-stats";
import { dailyIcStd } from "./walk-forward-logging";
import { evaluateAcceptanceBar, type AcceptanceBarResult } from "./acceptance-bar";

const FORWARD_DAYS = 5;

/**
 * Max overlay adjustment on the rank score scale. Judgment guardrail — a single
 * earnings reaction must not flip HOLD/SELL into a strong BUY on its own.
 */
export const OVERLAY_ADJUSTMENT_CAP = 0.15;

/** Map post-earnings % move to [-1, 1] for overlay fit/apply on rank score scale. */
export function earningsReactionInput(postEarningsReturn3d: number): number {
  return Math.tanh(postEarningsReturn3d / 6);
}

export interface EarningsOverlay {
  slope: number;
  intercept: number;
  trainedOnRows: number;
  trainedOnICStat: { meanIC: number; tStat: number };
  shrinkageMinRows: number;
  shrinkageFullRows: number;
  adjustmentCap: number;
}

export interface OverlayFoldRow {
  fold: number;
  testStart: string;
  testEnd: string;
  nNearEarningsRows: number;
  nNearEarningsTrainRows: number;
  meanICBaseOnly: number;
  meanICBasePlusOverlay: number;
  meanICFullBaseOnly: number;
  meanICFullBasePlusOverlay: number;
  overlayShrinkage: number;
}

export interface OverlayEvalResult {
  folds: OverlayFoldRow[];
  nearEarningsBaseOnly: IcSignificance;
  nearEarningsBasePlusOverlay: IcSignificance;
  fullBaseOnly: IcSignificance;
  fullBasePlusOverlay: IcSignificance;
  acceptanceBasePlus: AcceptanceBarResult;
  beatsBaseOnly: boolean;
  fullNotWorse: boolean;
  pass: boolean;
  finalOverlay: EarningsOverlay;
}

const DEFAULT_OVERLAY_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "earnings-overlay.json"
);

let cachedOverlay: EarningsOverlay | null | undefined;

export function isEarningsOverlayEnabled(): boolean {
  return process.env.ENABLE_EARNINGS_OVERLAY === "1";
}

export function getEarningsOverlayPath(): string {
  return process.env.EARNINGS_OVERLAY_PATH ?? DEFAULT_OVERLAY_PATH;
}

export function loadEarningsOverlay(force = false): EarningsOverlay | null {
  if (!force && cachedOverlay !== undefined) return cachedOverlay;
  const overlayPath = getEarningsOverlayPath();
  if (!fs.existsSync(overlayPath)) {
    cachedOverlay = null;
    return null;
  }
  try {
    cachedOverlay = JSON.parse(fs.readFileSync(overlayPath, "utf-8")) as EarningsOverlay;
    return cachedOverlay;
  } catch {
    cachedOverlay = null;
    return null;
  }
}

export function saveEarningsOverlay(overlay: EarningsOverlay, filePath?: string): void {
  const target = filePath ?? getEarningsOverlayPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(overlay, null, 2));
  cachedOverlay = overlay;
}

export function nearEarningsRowFilter(f: RawFeatures): boolean {
  return (
    f.hasRecentEarnings === 1 &&
    f.earningsDataAvailable === 1 &&
    f.postEarningsReturn3d !== 0
  );
}

/** Linear ramp: 0 below minRows, 1 at fullConfidenceRows+. */
export function shrinkageFactor(
  nTrainRows: number,
  minRows = 100,
  fullConfidenceRows = 500
): number {
  if (nTrainRows >= fullConfidenceRows) return 1.0;
  if (nTrainRows <= minRows) return 0.0;
  return (nTrainRows - minRows) / (fullConfidenceRows - minRows);
}

export function fitEarningsOverlay(
  rows: Array<{ x: number; y: number }>,
  icStat: { meanIC: number; tStat: number } = { meanIC: 0, tStat: 0 },
  shrinkage = { minRows: 100, fullRows: 500 }
): EarningsOverlay {
  const n = rows.length;
  if (n < 2) {
    return {
      slope: 0,
      intercept: 0,
      trainedOnRows: n,
      trainedOnICStat: icStat,
      shrinkageMinRows: shrinkage.minRows,
      shrinkageFullRows: shrinkage.fullRows,
      adjustmentCap: OVERLAY_ADJUSTMENT_CAP,
    };
  }

  const xs = rows.map((r) => r.x);
  const ys = rows.map((r) => r.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  return {
    slope,
    intercept,
    trainedOnRows: n,
    trainedOnICStat: icStat,
    shrinkageMinRows: shrinkage.minRows,
    shrinkageFullRows: shrinkage.fullRows,
    adjustmentCap: OVERLAY_ADJUSTMENT_CAP,
  };
}

export function overlayAdjustment(
  row: RawFeatures,
  overlay: EarningsOverlay,
  shrinkage = 1
): number {
  if (!nearEarningsRowFilter(row)) return 0;
  const x = earningsReactionInput(row.postEarningsReturn3d);
  const raw = overlay.slope * x + overlay.intercept;
  const capped = Math.max(
    -overlay.adjustmentCap,
    Math.min(overlay.adjustmentCap, raw * shrinkage)
  );
  return capped;
}

export function applyOverlay(
  baseScore: number,
  row: RawFeatures,
  overlay: EarningsOverlay,
  shrinkage?: number
): number {
  const sf =
    shrinkage ??
    shrinkageFactor(
      overlay.trainedOnRows,
      overlay.shrinkageMinRows,
      overlay.shrinkageFullRows
    );
  return baseScore + overlayAdjustment(row, overlay, sf);
}

function collectNearEarningsTrainRows(
  trainPrepared: PreparedSample[],
  sampleByKey: Map<string, TrainingSample>
): Array<{ x: number; y: number }> {
  const rows: Array<{ x: number; y: number }> = [];
  for (const s of trainPrepared) {
    const raw = sampleByKey.get(`${s.date}|${s.symbol}`);
    if (!raw || !nearEarningsRowFilter(raw.features)) continue;
    rows.push({ x: earningsReactionInput(raw.features.postEarningsReturn3d), y: s.target });
  }
  return rows;
}

function buildDatedPredictions(
  testPrepared: PreparedSample[],
  basePreds: number[],
  sampleByKey: Map<string, TrainingSample>,
  overlay: EarningsOverlay | null,
  shrinkage: number,
  rowFilter?: (f: RawFeatures) => boolean
): Array<{ date: string; predicted: number; actual: number }> {
  const dated: Array<{ date: string; predicted: number; actual: number }> = [];
  testPrepared.forEach((s, i) => {
    const raw = sampleByKey.get(`${s.date}|${s.symbol}`);
    if (!raw) return;
    if (rowFilter && !rowFilter(raw.features)) return;

    let predicted = basePreds[i]!;
    if (overlay) {
      predicted = applyOverlay(predicted, raw.features, overlay, shrinkage);
    }
    dated.push({ date: s.date, predicted, actual: s.target });
  });
  return dated;
}

export function runOverlayWalkForwardEval(
  samples: TrainingSample[],
  options: {
    auditedIcStat?: { meanIC: number; tStat: number };
    shrinkageMinRows?: number;
    shrinkageFullRows?: number;
    nFolds?: number;
    testDays?: number;
    minTrainDays?: number;
  } = {}
): OverlayEvalResult | null {
  const coreKeys = CORE_RANKER_FEATURE_KEYS;
  const prepared = prepareCrossSectionalSamples(samples, {
    targetType: "rank",
    featureKeys: coreKeys,
  });
  if (prepared.length < 200) return null;

  const shrinkageMin = options.shrinkageMinRows ?? 100;
  const shrinkageFull = options.shrinkageFullRows ?? 500;
  const icStat = options.auditedIcStat ?? { meanIC: 0, tStat: 0 };

  const sampleByKey = new Map(samples.map((s) => [`${s.date}|${s.symbol}`, s]));
  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();
  const nFolds = options.nFolds ?? 6;
  const testDays = options.testDays ?? 60;
  const minTrainDays = options.minTrainDays ?? 120;
  const totalTestSpan = nFolds * testDays;
  const startIdx = Math.max(minTrainDays, uniqueDates.length - totalTestSpan);

  const folds: OverlayFoldRow[] = [];
  const dailyNearBase: number[] = [];
  const dailyNearOverlay: number[] = [];
  const dailyFullBase: number[] = [];
  const dailyFullOverlay: number[] = [];

  let lastOverlay: EarningsOverlay = fitEarningsOverlay([], icStat, {
    minRows: shrinkageMin,
    fullRows: shrinkageFull,
  });

  for (let f = 0; f < nFolds; f++) {
    const testStartIdx = startIdx + f * testDays;
    const testEndIdx = Math.min(testStartIdx + testDays, uniqueDates.length);
    if (testStartIdx >= uniqueDates.length) break;

    const purge = trainEndWithLabelPurge(uniqueDates, testStartIdx, FORWARD_DAYS);
    if (!purge) continue;

    const testStart = uniqueDates[testStartIdx]!;
    const testEnd = uniqueDates[testEndIdx - 1]!;
    const trainEnd = purge.trainEnd;

    const trainPrepared = prepared.filter((s) => s.date <= trainEnd);
    const testPrepared = prepared.filter(
      (s) => s.date >= testStart && s.date <= testEnd
    );
    if (trainPrepared.length < 60 || testPrepared.length < 20) continue;

    const holdout = evaluateHoldoutSplit(trainPrepared, testPrepared, { tuneLambda: true });
    const basePreds = predictHoldoutTest(testPrepared, holdout);

    const trainNearRows = collectNearEarningsTrainRows(trainPrepared, sampleByKey);
    const overlay = fitEarningsOverlay(trainNearRows, icStat, {
      minRows: shrinkageMin,
      fullRows: shrinkageFull,
    });
    lastOverlay = overlay;
    const sf = shrinkageFactor(trainNearRows.length, shrinkageMin, shrinkageFull);

    const nearBase = buildDatedPredictions(
      testPrepared,
      basePreds,
      sampleByKey,
      null,
      0,
      nearEarningsRowFilter
    );
    const nearOverlay = buildDatedPredictions(
      testPrepared,
      basePreds,
      sampleByKey,
      overlay,
      sf,
      nearEarningsRowFilter
    );
    const fullBase = buildDatedPredictions(testPrepared, basePreds, sampleByKey, null, 0);
    const fullOverlay = buildDatedPredictions(
      testPrepared,
      basePreds,
      sampleByKey,
      overlay,
      sf
    );

    const icNearBase = dailyIcSeries(nearBase);
    const icNearOverlay = dailyIcSeries(nearOverlay);
    const icFullBase = dailyIcSeries(fullBase);
    const icFullOverlay = dailyIcSeries(fullOverlay);

    dailyNearBase.push(...icNearBase);
    dailyNearOverlay.push(...icNearOverlay);
    dailyFullBase.push(...icFullBase);
    dailyFullOverlay.push(...icFullOverlay);

    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

    folds.push({
      fold: f + 1,
      testStart,
      testEnd,
      nNearEarningsRows: nearBase.length,
      nNearEarningsTrainRows: trainNearRows.length,
      meanICBaseOnly: mean(icNearBase),
      meanICBasePlusOverlay: mean(icNearOverlay),
      meanICFullBaseOnly: mean(icFullBase),
      meanICFullBasePlusOverlay: mean(icFullOverlay),
      overlayShrinkage: sf,
    });
  }

  if (folds.length === 0) return null;

  const nearEarningsBaseOnly = icSignificance(dailyNearBase);
  const nearEarningsBasePlusOverlay = icSignificance(dailyNearOverlay);
  const fullBaseOnly = icSignificance(dailyFullBase);
  const fullBasePlusOverlay = icSignificance(dailyFullOverlay);

  const foldMeanIcs = folds.map((f) => f.meanICBasePlusOverlay);
  const acceptanceBasePlus = evaluateAcceptanceBar(foldMeanIcs, nearEarningsBasePlusOverlay);
  const beatsBaseOnly =
    nearEarningsBasePlusOverlay.meanIC > nearEarningsBaseOnly.meanIC;
  const fullNotWorse = fullBasePlusOverlay.meanIC >= fullBaseOnly.meanIC - 0.002;
  const pass = acceptanceBasePlus.pass && beatsBaseOnly && fullNotWorse;

  const prodRows = collectNearEarningsTrainRows(prepared, sampleByKey);
  const finalOverlay = fitEarningsOverlay(prodRows, icStat, {
    minRows: shrinkageMin,
    fullRows: shrinkageFull,
  });

  return {
    folds,
    nearEarningsBaseOnly,
    nearEarningsBasePlusOverlay,
    fullBaseOnly,
    fullBasePlusOverlay,
    acceptanceBasePlus,
    beatsBaseOnly,
    fullNotWorse,
    pass,
    finalOverlay: { ...finalOverlay, trainedOnRows: prodRows.length },
  };
}

export function fitProductionEarningsOverlay(
  samples: TrainingSample[],
  icStat: { meanIC: number; tStat: number }
): EarningsOverlay {
  const prepared = prepareCrossSectionalSamples(samples, {
    targetType: "rank",
    featureKeys: CORE_RANKER_FEATURE_KEYS,
  });
  const sampleByKey = new Map(samples.map((s) => [`${s.date}|${s.symbol}`, s]));
  const rows = collectNearEarningsTrainRows(prepared, sampleByKey);
  return fitEarningsOverlay(rows, icStat, { minRows: 100, fullRows: 500 });
}

export function printOverlayEvalTable(result: OverlayEvalResult): void {
  console.log("\n── Overlay walk-forward: base_only vs base_plus_overlay ──\n");
  console.log(
    "fold | test_start  | test_end    | near_rows | train_near | shrink | IC_base  | IC+overlay | Δ"
  );
  console.log("-".repeat(95));
  for (const f of result.folds) {
    const delta = f.meanICBasePlusOverlay - f.meanICBaseOnly;
    console.log(
      `${String(f.fold).padStart(4)} | ${f.testStart} | ${f.testEnd} | ${String(f.nNearEarningsRows).padStart(9)} | ${String(f.nNearEarningsTrainRows).padStart(10)} | ${f.overlayShrinkage.toFixed(2).padStart(6)} | ${f.meanICBaseOnly >= 0 ? "+" : ""}${f.meanICBaseOnly.toFixed(4).padStart(7)} | ${f.meanICBasePlusOverlay >= 0 ? "+" : ""}${f.meanICBasePlusOverlay.toFixed(4).padStart(10)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`
    );
  }
  console.log("-".repeat(95));
  const nb = result.nearEarningsBaseOnly;
  const no = result.nearEarningsBasePlusOverlay;
  const fb = result.fullBaseOnly;
  const fo = result.fullBasePlusOverlay;
  console.log(
    `Near-earnings: base ${nb.meanIC >= 0 ? "+" : ""}${nb.meanIC.toFixed(4)} (t=${nb.tStat.toFixed(2)}) → overlay ${no.meanIC >= 0 ? "+" : ""}${no.meanIC.toFixed(4)} (t=${no.tStat.toFixed(2)})`
  );
  console.log(
    `Full dataset:  base ${fb.meanIC >= 0 ? "+" : ""}${fb.meanIC.toFixed(4)} (t=${fb.tStat.toFixed(2)}) → overlay ${fo.meanIC >= 0 ? "+" : ""}${fo.meanIC.toFixed(4)} (t=${fo.tStat.toFixed(2)})`
  );
  console.log(
    `Acceptance (near-earnings base+overlay): ${result.acceptanceBasePlus.pass ? "PASS" : "FAIL"} · beats base: ${result.beatsBaseOnly} · full not worse: ${result.fullNotWorse} · overall: ${result.pass ? "PASS" : "FAIL"}`
  );
}

export { dailyIcStd };
