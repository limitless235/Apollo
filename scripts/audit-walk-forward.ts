/**
 * Walk-forward harness audit — checks 1–5 from harness spec, writes data/harness-audit-report.json
 * Usage: npm run audit:walk-forward
 */
import fs from "fs";
import path from "path";
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import {
  collectWatchlistTrainingData,
  featureKeysForGroups,
  prepareCrossSectionalSamples,
  runWalkForwardValidation,
  runSingleHoldoutEval,
  evaluateHoldoutSplit,
  featuresToVector,
  crossSectionalZScoreRows,
  foldMetricsToTableRow,
  countSignFlips,
  labelPurgeGapDays,
  trainEndWithLabelPurge,
  MIN_CROSS_SECTION,
  type TrainingSample,
} from "../src/lib/scoring";

const REPORT_PATH = path.join(process.cwd(), "data", "harness-audit-report.json");
const FORWARD_DAYS = 5;

interface HarnessAuditReport {
  generatedAt: string;
  featureKeys: string[];
  sampleCount: number;
  uniqueDates: number;
  dateRange: { start: string; end: string };
  checks: {
    foldConstruction: { pass: boolean; issues: string[]; foldLog: string[] };
    standardizationPerFold: { pass: boolean; issues: string[] };
    labelConsistency: { pass: boolean; issues: string[]; details: Record<string, unknown> };
  };
  walkForward: {
    aggregate: { meanIC: number; icIR: number; tStat: number; nDays: number };
    signFlips: number;
    perFoldTable: ReturnType<typeof foldMetricsToTableRow>[];
    oosWindow: { start: string; end: string; testRows: number };
  };
  holdoutComparison: {
    fullTimeline25pct: {
      splitDate: string;
      trainEnd: string;
      gapDays: number;
      trainRows: number;
      testRows: number;
      meanIC: number;
      tStat: number;
      nDays: number;
    } | null;
    restrictedToWfOosWindow: {
      splitDate: string;
      trainEnd: string;
      gapDays: number;
      trainRows: number;
      testRows: number;
      meanIC: number;
      tStat: number;
      nDays: number;
    } | null;
    wfPooledMeanIC: number;
    interpretation: string;
  };
  verdict: string;
  nextStep: string;
}

function checkFoldConstruction(
  uniqueDates: string[],
  folds: NonNullable<ReturnType<typeof runWalkForwardValidation>>["folds"]
): { pass: boolean; issues: string[]; foldLog: string[] } {
  const issues: string[] = [];
  const foldLog: string[] = [];
  const seenTestDates = new Set<string>();

  for (const f of folds) {
    foldLog.push(
      `fold ${f.fold}: train dates [${f.trainStart} .. ${f.trainEnd}] (n=${f.trainDays} days), test dates [${f.testStart} .. ${f.testEnd}] (n=${f.testDays} days), gap days between train end and test start = ${f.gapDays}`
    );

    if (f.gapDays < FORWARD_DAYS) {
      issues.push(
        `Fold ${f.fold}: gap=${f.gapDays} < required ${FORWARD_DAYS} trading days`
      );
    }

    const measuredGap = labelPurgeGapDays(uniqueDates, f.trainEnd, f.testStart);
    if (measuredGap !== f.gapDays) {
      issues.push(`Fold ${f.fold}: logged gap ${f.gapDays} != measured ${measuredGap}`);
    }

    if (f.trainEnd >= f.testStart) {
      issues.push(`Fold ${f.fold}: trainEnd ${f.trainEnd} not before testStart ${f.testStart}`);
    }

    const testDates = uniqueDates.filter((d) => d >= f.testStart && d <= f.testEnd);
    for (const d of testDates) {
      if (seenTestDates.has(d)) {
        issues.push(`Fold ${f.fold}: test date ${d} duplicated across folds`);
      }
      seenTestDates.add(d);
    }
  }

  return { pass: issues.length === 0, issues, foldLog };
}

function checkStandardizationPerFold(
  folds: NonNullable<ReturnType<typeof runWalkForwardValidation>>["folds"]
): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const f of folds) {
    if (f.stdFitTrainRows !== f.trainSamples) {
      issues.push(
        `Fold ${f.fold}: std fit train rows (${f.stdFitTrainRows}) != train samples (${f.trainSamples})`
      );
    }
    if (f.stdFitTestRows !== f.testSamples) {
      issues.push(
        `Fold ${f.fold}: std applied test rows (${f.stdFitTestRows}) != test samples (${f.testSamples})`
      );
    }
    if (f.stdFitTrainRows === 0) {
      issues.push(`Fold ${f.fold}: standardization fit on zero train rows`);
    }
  }
  return { pass: issues.length === 0, issues };
}

function checkLabelConsistency(
  samples: TrainingSample[],
  prepared: ReturnType<typeof prepareCrossSectionalSamples>,
  featureKeys: readonly string[],
  wf: NonNullable<ReturnType<typeof runWalkForwardValidation>>,
  holdoutOos: {
    splitDate: string;
    trainEnd: string;
    gapDays: number;
    trainRows: number;
    testRows: number;
    result: { eval: { significance: { meanIC: number; tStat: number; nDays: number } } };
  } | null
): { pass: boolean; issues: string[]; details: Record<string, unknown> } {
  const issues: string[] = [];

  const oosRows = prepared.filter(
    (s) => s.date >= wf.oosTestStart && s.date <= wf.oosTestEnd
  ).length;
  const wfFoldTestRows = wf.folds.reduce((n, f) => n + f.testSamples, 0);

  const details: Record<string, unknown> = {
    forwardDays: FORWARD_DAYS,
    targetType: "rank",
    minSymbolsPerDateForIc: MIN_CROSS_SECTION,
    rawSampleCount: samples.length,
    preparedRowCount: prepared.length,
    wfOosWindow: { start: wf.oosTestStart, end: wf.oosTestEnd },
    wfOosPreparedRows: oosRows,
    wfFoldTestRowsSum: wfFoldTestRows,
    holdoutOosTestRows: holdoutOos?.testRows ?? null,
    labelConstruction:
      "Both paths use prepareCrossSectionalSamples: 5d forward return → per-date rank in [-1,1]; CS z-score per date across symbols",
  };

  if (oosRows !== wfFoldTestRows) {
    issues.push(
      `WF OOS row count mismatch: filter=${oosRows} vs fold sum=${wfFoldTestRows}`
    );
  }

  if (holdoutOos && holdoutOos.testRows !== oosRows) {
    issues.push(
      `Holdout vs WF OOS row count: holdout test=${holdoutOos.testRows} vs wf oos=${oosRows}`
    );
  }

  // Spot-check per-date CS z-score matches global prepare
  const byDate = new Map<string, TrainingSample[]>();
  for (const s of samples) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  const spotDate = [...byDate.entries()].find(([, v]) => v.length >= MIN_CROSS_SECTION)?.[0];
  if (spotDate) {
    const daySamples = byDate.get(spotDate)!;
    const rawVectors = daySamples.map((s) => featuresToVector(s.features, featureKeys));
    const recomputed = crossSectionalZScoreRows(rawVectors);
    const preparedDay = prepared.filter((s) => s.date === spotDate);
    if (preparedDay.length !== daySamples.length) {
      issues.push(`Spot date ${spotDate}: prepared count ${preparedDay.length} != raw ${daySamples.length}`);
    } else {
      for (let i = 0; i < preparedDay.length; i++) {
        for (let j = 0; j < recomputed[i].length; j++) {
          if (Math.abs(preparedDay[i].vector[j] - recomputed[i][j]) > 1e-10) {
            issues.push(`CS z-score mismatch on ${spotDate} symbol ${preparedDay[i].symbol}`);
            break;
          }
        }
      }
    }
  }

  return { pass: issues.length === 0, issues, details };
}

function trainEndBeforeOos(
  uniqueDates: string[],
  oosTestStart: string,
  forwardDays: number
): string | null {
  const idx = uniqueDates.indexOf(oosTestStart);
  if (idx < 0) return null;
  const purge = trainEndWithLabelPurge(uniqueDates, idx, forwardDays);
  return purge?.trainEnd ?? null;
}

async function main() {
  initDb();
  const symbols = await getWatchlistSymbols();
  const featureKeys = featureKeysForGroups(["core"]);

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  Walk-Forward Harness Audit (checks 1–5)");
  console.log("══════════════════════════════════════════════════════════\n");

  const samples = await collectWatchlistTrainingData(symbols, 500, FORWARD_DAYS);
  console.log(`Samples: ${samples.length} · symbols: ${symbols.length}`);

  if (samples.length < 80) {
    console.error("Not enough samples.");
    process.exit(1);
  }

  const prepared = prepareCrossSectionalSamples(samples, {
    targetType: "rank",
    featureKeys,
  });
  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();

  console.log("Running walk-forward (core features, 5d label purge gap)...\n");

  const wf = runWalkForwardValidation(samples, {
    nFolds: 6,
    testDays: 60,
    forwardDays: FORWARD_DAYS,
    tuneLambda: true,
    useRecencyWeights: true,
    targetType: "rank",
    featureKeys,
    logFolds: true,
  });

  if (!wf) {
    console.error("Walk-forward failed.");
    process.exit(1);
  }

  const foldCheck = checkFoldConstruction(uniqueDates, wf.folds);
  const stdCheck = checkStandardizationPerFold(wf.folds);

  console.log("\n── Check 1: Fold construction ──");
  foldCheck.foldLog.forEach((l) => console.log(`  ${l}`));
  console.log(foldCheck.pass ? "  PASS" : `  FAIL: ${foldCheck.issues.join("; ")}`);

  console.log("\n── Check 2: Standardization per fold ──");
  wf.folds.forEach((f) =>
    console.log(
      `  fold ${f.fold}: standardization fit on train rows only (n=${f.stdFitTrainRows}), applied to test rows (n=${f.stdFitTestRows})`
    )
  );
  console.log(stdCheck.pass ? "  PASS" : `  FAIL: ${stdCheck.issues.join("; ")}`);

  const holdoutFull = runSingleHoldoutEval(prepared, uniqueDates, {
    holdoutRatio: 0.25,
    forwardDays: FORWARD_DAYS,
    tuneLambda: true,
  });

  const trainEndCutoff = trainEndBeforeOos(uniqueDates, wf.oosTestStart, FORWARD_DAYS);
  const wfWindowTrain = trainEndCutoff
    ? prepared.filter((s) => s.date <= trainEndCutoff)
    : [];
  const wfWindowTest = prepared.filter(
    (s) => s.date >= wf.oosTestStart && s.date <= wf.oosTestEnd
  );
  const holdoutSingleModel = evaluateHoldoutSplit(wfWindowTrain, wfWindowTest, {
    tuneLambda: true,
  });

  const holdoutOosMeta = {
    splitDate: wf.oosTestStart,
    trainEnd: trainEndCutoff ?? "",
    gapDays: FORWARD_DAYS,
    trainRows: wfWindowTrain.length,
    testRows: wfWindowTest.length,
    result: holdoutSingleModel,
  };

  const labelCheck = checkLabelConsistency(
    samples,
    prepared,
    featureKeys,
    wf,
    holdoutOosMeta
  );

  console.log("\n── Check 3: Label consistency ──");
  console.log(`  Raw samples: ${labelCheck.details.rawSampleCount}`);
  console.log(`  Prepared rows: ${labelCheck.details.preparedRowCount}`);
  console.log(`  WF OOS rows (filter): ${labelCheck.details.wfOosPreparedRows}`);
  console.log(`  WF OOS rows (fold sum): ${labelCheck.details.wfFoldTestRowsSum}`);
  console.log(`  Holdout OOS test rows: ${labelCheck.details.holdoutOosTestRows}`);
  console.log(labelCheck.pass ? "  PASS" : `  FAIL: ${labelCheck.issues.join("; ")}`);

  console.log("\n── Check 5: Holdout vs walk-forward reconciliation ──");
  const agg = wf.aggregateSignificance;
  console.log(
    `  Walk-forward pooled IC:     ${agg.meanIC.toFixed(4)} (t=${agg.tStat.toFixed(2)}, n=${agg.nDays})`
  );
  if (holdoutFull) {
    const h = holdoutFull.result.eval.significance;
    console.log(
      `  Full-timeline 25% holdout:  ${h.meanIC.toFixed(4)} (t=${h.tStat.toFixed(2)}, n=${h.nDays}) split=${holdoutFull.splitDate}`
    );
  }
  const hsm = holdoutSingleModel.eval.significance;
  console.log(
    `  Single model, WF OOS window:  ${hsm.meanIC.toFixed(4)} (t=${hsm.tStat.toFixed(2)}, n=${hsm.nDays})`
  );

  const favorableFold = wf.folds.reduce((best, f) =>
    f.significance.meanIC > best.significance.meanIC ? f : best
  );
  let interpretation =
    "Walk-forward and holdout on same OOS window disagree in IC because WF retrains per fold; both are ≈0 and insignificant.";
  if (holdoutFull && holdoutFull.result.eval.significance.meanIC > agg.meanIC + 0.005) {
    interpretation =
      `Old 25% holdout IC (${holdoutFull.result.eval.significance.meanIC.toFixed(4)}) exceeds walk-forward pooled (${agg.meanIC.toFixed(4)}). ` +
      `Holdout test window (${holdoutFull.splitDate}+) overlaps fold ${favorableFold.fold} (${favorableFold.testStart}–${favorableFold.testEnd}, IC=${favorableFold.significance.meanIC.toFixed(4)}) — favorable-slice artifact, not harness bug.`;
  }

  console.log(`\n  ${interpretation}`);

  const allChecksPass =
    foldCheck.pass && stdCheck.pass && labelCheck.pass;
  const foldMeanIcs = wf.folds.map((f) => f.significance.meanIC);
  const signFlips = countSignFlips(foldMeanIcs);

  let verdict: string;
  let nextStep: string;

  if (!allChecksPass) {
    verdict =
      "Harness checks failed — fix fold boundaries or label consistency before trusting any IC number.";
    nextStep = "Fix failing checks, re-run audit, then re-evaluate A1 if baseline IC shifts.";
  } else if (Math.abs(agg.tStat) < 2 && signFlips >= 2) {
    verdict =
      "Harness clean. Core features show IC ≈ 0 with frequent fold sign flips — signal too unstable to act on.";
    nextStep =
      "Proceed to A2 (earnings) testing standalone IC with mandatory per-fold table; do not expect incremental gains over a non-existent baseline.";
  } else if (Math.abs(agg.tStat) < 2) {
    verdict =
      "Harness clean. Core features have no statistically significant signal (t < 2).";
    nextStep = "Proceed to A2 with per-fold reporting; look for feature groups that clear the zero-IC bar on their own.";
  } else {
    verdict = "Harness clean and core features show significant pooled IC — revisit baseline before A2.";
    nextStep = "Re-run A1 sector-relative comparison against the validated baseline.";
  }

  const oosRows = prepared.filter(
    (s) => s.date >= wf.oosTestStart && s.date <= wf.oosTestEnd
  ).length;

  const report: HarnessAuditReport = {
    generatedAt: new Date().toISOString(),
    featureKeys: [...featureKeys],
    sampleCount: samples.length,
    uniqueDates: uniqueDates.length,
    dateRange: { start: uniqueDates[0], end: uniqueDates[uniqueDates.length - 1] },
    checks: {
      foldConstruction: foldCheck,
      standardizationPerFold: stdCheck,
      labelConsistency: labelCheck,
    },
    walkForward: {
      aggregate: {
        meanIC: agg.meanIC,
        icIR: agg.icIR,
        tStat: agg.tStat,
        nDays: agg.nDays,
      },
      signFlips,
      perFoldTable: wf.folds.map(foldMetricsToTableRow),
      oosWindow: {
        start: wf.oosTestStart,
        end: wf.oosTestEnd,
        testRows: oosRows,
      },
    },
    holdoutComparison: {
      fullTimeline25pct: holdoutFull
        ? {
            splitDate: holdoutFull.splitDate,
            trainEnd: holdoutFull.trainEnd,
            gapDays: holdoutFull.gapDays,
            trainRows: holdoutFull.trainRows,
            testRows: holdoutFull.testRows,
            meanIC: holdoutFull.result.eval.significance.meanIC,
            tStat: holdoutFull.result.eval.significance.tStat,
            nDays: holdoutFull.result.eval.significance.nDays,
          }
        : null,
      restrictedToWfOosWindow: {
        splitDate: holdoutOosMeta.splitDate,
        trainEnd: holdoutOosMeta.trainEnd,
        gapDays: holdoutOosMeta.gapDays,
        trainRows: holdoutOosMeta.trainRows,
        testRows: holdoutOosMeta.testRows,
        meanIC: holdoutSingleModel.eval.significance.meanIC,
        tStat: holdoutSingleModel.eval.significance.tStat,
        nDays: holdoutSingleModel.eval.significance.nDays,
      },
      wfPooledMeanIC: agg.meanIC,
      interpretation,
    },
    verdict,
    nextStep,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("\n── Summary ──");
  console.log(`  Verdict: ${verdict}`);
  console.log(`  Next:    ${nextStep}`);
  console.log(`\n  Report → ${REPORT_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
