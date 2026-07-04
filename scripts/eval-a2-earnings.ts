/**
 * A2 earnings feature acceptance — subset-first evaluation + outlier audit + overlay.
 * Usage: npm run eval:a2-earnings
 */
import fs from "fs";
import path from "path";
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import { collectWatchlistTrainingData } from "../src/lib/scoring";
import {
  runSubsetWalkForwardEval,
  printSubsetFoldTable,
} from "../src/lib/scoring/subset-eval";
import { featureKeysForGroups } from "../src/lib/scoring/feature-vector";
import type { RawFeatures } from "../src/lib/scoring/features";
import {
  runPostEarningsOutlierAudit,
  printOutlierAudit,
} from "../src/lib/scoring/earnings-audit";
import {
  runOverlayWalkForwardEval,
  printOverlayEvalTable,
  saveEarningsOverlay,
  OVERLAY_ADJUSTMENT_CAP,
} from "../src/lib/scoring/earnings-overlay";

const REPORT_PATH = path.join(process.cwd(), "data", "a2-earnings-report.json");
const OVERLAY_PATH = path.join(process.cwd(), "data", "earnings-overlay.json");

async function main() {
  initDb();
  const symbols = await getWatchlistSymbols();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  A2 Earnings — outlier audit + conditional overlay eval");
  console.log("══════════════════════════════════════════════════════════\n");

  console.log(`Universe: ${symbols.length} symbols`);
  console.log("Collecting samples with earnings features...\n");

  const samples = await collectWatchlistTrainingData(symbols, 500, 5);
  console.log(`  Samples: ${samples.length}`);

  const withEarnings = samples.filter((s) => s.features.earningsDataAvailable === 1);
  const nearEarnings = samples.filter((s) => s.features.hasRecentEarnings === 1);
  console.log(`  Rows with earnings in lookback: ${withEarnings.length}`);
  console.log(`  Rows near earnings (≤5d): ${nearEarnings.length}\n`);

  if (samples.length < 80) {
    console.error("Not enough samples.");
    process.exit(1);
  }

  const nearEarningsFilter = (f: RawFeatures) => f.hasRecentEarnings === 1;
  const restFilter = (f: RawFeatures) => f.hasRecentEarnings !== 1;

  const postEarnNear = runSubsetWalkForwardEval(samples, {
    subsetName: "Near-earnings · postEarningsReturn3d standalone",
    rowFilter: nearEarningsFilter,
    predictScore: (f) =>
      f.earningsDataAvailable === 1 && f.postEarningsReturn3d !== 0
        ? f.postEarningsReturn3d
        : null,
  });

  const daysSinceNear = runSubsetWalkForwardEval(samples, {
    subsetName: "Near-earnings · daysSinceEarnings standalone",
    rowFilter: nearEarningsFilter,
    predictScore: (f) =>
      f.earningsDataAvailable === 1 ? -f.daysSinceEarnings : null,
  });

  const restSubset = runSubsetWalkForwardEval(samples, {
    subsetName: "Rest (non-earnings) · momentum20d sanity",
    rowFilter: restFilter,
    predictScore: (f) => f.momentum20d,
  });

  if (!postEarnNear || !restSubset) {
    console.error("Subset eval failed — insufficient data.");
    process.exit(1);
  }

  printSubsetFoldTable(postEarnNear);
  if (daysSinceNear) printSubsetFoldTable(daysSinceNear);
  printSubsetFoldTable(restSubset);

  const outlierAudit = runPostEarningsOutlierAudit(samples);
  if (outlierAudit) {
    printOutlierAudit(outlierAudit);
  } else {
    console.warn("Outlier audit skipped — insufficient near-earnings data.");
  }

  const auditedIc =
    outlierAudit?.overlayIcBasis === "winsorized"
      ? outlierAudit.pooledWinsorized
      : outlierAudit?.pooledRaw ?? postEarnNear.aggregate;

  const overlayEval = runOverlayWalkForwardEval(samples, {
    auditedIcStat: { meanIC: auditedIc.meanIC, tStat: auditedIc.tStat },
    shrinkageMinRows: 100,
    shrinkageFullRows: 500,
  });

  if (overlayEval) {
    printOverlayEvalTable(overlayEval);
  }

  const subsetPasses = postEarnNear.acceptance.pass;
  const overlayPasses = overlayEval?.pass ?? false;
  const enableOverlay = subsetPasses && overlayPasses;

  if (enableOverlay && overlayEval) {
    saveEarningsOverlay(overlayEval.finalOverlay, OVERLAY_PATH);
    console.log(`\nOverlay params saved → ${OVERLAY_PATH}`);
    console.log("Enable live overlay: ENABLE_EARNINGS_OVERLAY=1\n");
  }

  const coreBaselineIC = -0.013;

  const report = {
    generatedAt: new Date().toISOString(),
    sampleStats: {
      totalSamples: samples.length,
      withEarningsLookback: withEarnings.length,
      nearEarningsRows: nearEarnings.length,
    },
    acceptanceBar: {
      rules: [
        "|t-stat| > 2 on near-earnings subset (standalone postEarningsReturn3d)",
        "≤ 1 sign flip across folds on subset",
        "Overlay: base+overlay beats base_only on near-earnings subset",
        "Overlay: full-dataset IC not worse than base_only",
        "Adjustment cap ±0.15 on rank score scale",
      ],
    },
    nearEarningsPostReturn3d: {
      folds: postEarnNear.folds,
      aggregate: postEarnNear.aggregate,
      acceptance: postEarnNear.acceptance,
      subsetPasses,
      lowDayWarnings: postEarnNear.folds.filter((f) => f.lowDayCountWarning),
    },
    nearEarningsDaysSince: daysSinceNear
      ? {
          folds: daysSinceNear.folds,
          aggregate: daysSinceNear.aggregate,
          acceptance: daysSinceNear.acceptance,
        }
      : null,
    restSanity: {
      folds: restSubset.folds,
      aggregate: restSubset.aggregate,
      acceptance: restSubset.acceptance,
      note: "Should resemble core baseline (~-0.013); validates subset split is not leaking",
    },
    outlierAudit: outlierAudit
      ? {
          fold4Rows: outlierAudit.fold4Rows,
          fold4RowCount: outlierAudit.fold4Rows.length,
          fold4Top10ByAbsReturn: outlierAudit.fold4Top10ByAbsReturn,
          fold4Qualitative: outlierAudit.fold4Qualitative,
          icByFoldRawVsWinsorized: outlierAudit.icByFold,
          pooledRaw: outlierAudit.pooledRaw,
          pooledWinsorized: outlierAudit.pooledWinsorized,
          acceptanceRaw: outlierAudit.acceptanceRaw,
          acceptanceWinsorized: outlierAudit.acceptanceWinsorized,
          interpretation: outlierAudit.interpretation,
          overlayIcBasis: outlierAudit.overlayIcBasis,
        }
      : null,
    overlayEval: overlayEval
      ? {
          folds: overlayEval.folds,
          nearEarningsBaseOnly: overlayEval.nearEarningsBaseOnly,
          nearEarningsBasePlusOverlay: overlayEval.nearEarningsBasePlusOverlay,
          fullBaseOnly: overlayEval.fullBaseOnly,
          fullBasePlusOverlay: overlayEval.fullBasePlusOverlay,
          acceptance: overlayEval.acceptanceBasePlus,
          beatsBaseOnly: overlayEval.beatsBaseOnly,
          fullNotWorse: overlayEval.fullNotWorse,
          pass: overlayEval.pass,
          adjustmentCap: OVERLAY_ADJUSTMENT_CAP,
          finalOverlay: overlayEval.finalOverlay,
        }
      : null,
    coreBaselineIC,
    ridgeFeatureKeys: featureKeysForGroups(["core"]),
    enableEarningsInRidge: false,
    enableEarningsOverlay: enableOverlay,
    verdict: enableOverlay
      ? "PASS — earnings overlay ready; ENABLE_EARNINGS_OVERLAY=1"
      : subsetPasses
        ? "PARTIAL — standalone signal passes but overlay eval did not meet bar"
        : "FAIL — earnings signal did not pass subset acceptance",
    nextStep: enableOverlay
      ? "ENABLE_EARNINGS_OVERLAY=1 npm run dev"
      : subsetPasses
        ? "Review overlay fold table; tune shrinkage or investigate fold 4 outliers"
        : "Do not enable overlay; investigate earnings data coverage",
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n── Verdict: ${report.verdict} ──`);
  console.log(`Report → ${REPORT_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
