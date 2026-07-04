/**
 * A1 acceptance test: walk-forward IC with vs without sector/market-relative features.
 * Usage: npm run eval:feature-group
 */
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import {
  collectWatchlistTrainingData,
  featureKeysForGroups,
  runWalkForwardValidation,
  printWalkForwardFoldTable,
} from "../src/lib/scoring";

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

async function main() {
  initDb();
  const symbols = await getWatchlistSymbols();

  if (symbols.length < 5) {
    console.log("Need at least 5 watchlist symbols.");
    process.exit(1);
  }

  console.log("\nApollo Feature Group Acceptance — A1 (relative features)\n");
  console.log(`Universe: ${symbols.length} symbols\n`);
  console.log("Collecting samples with benchmark indices...");

  const samples = await collectWatchlistTrainingData(symbols, 500, 5);
  console.log(`  Samples: ${samples.length}\n`);

  if (samples.length < 80) {
    console.log("Not enough samples (need ≥80).");
    process.exit(1);
  }

  const coreKeys = featureKeysForGroups(["core"]);
  const withRelativeKeys = featureKeysForGroups(["core", "relative"]);

  const opts = {
    nFolds: 6,
    testDays: 60,
    forwardDays: 5,
    tuneLambda: true,
    useRecencyWeights: true,
    targetType: "rank" as const,
    logFolds: true,
  };

  console.log("Running walk-forward — baseline (core only)...");
  const baseline = runWalkForwardValidation(samples, {
    ...opts,
    featureKeys: coreKeys,
  });

  console.log("Running walk-forward — core + relative...");
  const withRelative = runWalkForwardValidation(samples, {
    ...opts,
    featureKeys: withRelativeKeys,
  });

  if (!baseline || !withRelative) {
    console.log("\nWalk-forward failed — insufficient data.");
    process.exit(1);
  }

  const b = baseline.aggregateSignificance;
  const r = withRelative.aggregateSignificance;

  console.log("\n── Results ──\n");
  console.log(
    `${"Feature set".padEnd(22)} ${"Mean IC".padStart(8)} ${"IC IR".padStart(8)} ${"t-stat".padStart(8)} ${"nDays".padStart(6)}`
  );
  console.log("-".repeat(56));
  console.log(
    `${"Core (13)".padEnd(22)} ${fmt(b.meanIC).padStart(8)} ${fmt(b.icIR).padStart(8)} ${fmt(b.tStat, 2).padStart(8)} ${String(b.nDays).padStart(6)}`
  );
  console.log(
    `${"Core + relative (18)".padEnd(22)} ${fmt(r.meanIC).padStart(8)} ${fmt(r.icIR).padStart(8)} ${fmt(r.tStat, 2).padStart(8)} ${String(r.nDays).padStart(6)}`
  );

  const icDelta = r.meanIC - b.meanIC;
  const irDelta = r.icIR - b.icIR;
  console.log(`\nΔ Mean IC: ${icDelta >= 0 ? "+" : ""}${fmt(icDelta)}`);
  console.log(`Δ IC IR:   ${irDelta >= 0 ? "+" : ""}${fmt(irDelta)}`);

  const passes =
    r.meanIC > b.meanIC || r.icIR > b.icIR;

  console.log("\n── Baseline (core) per-fold table ──");
  printWalkForwardFoldTable(baseline.folds, b);

  console.log("\n── Core + relative per-fold table ──");
  printWalkForwardFoldTable(withRelative.folds, r);

  console.log("\n── Acceptance summary ──\n");
  if (passes) {
    console.log("✓ PASS — relative features improve IC or IC IR.");
    console.log("  Enable with ENABLE_RELATIVE_FEATURES=1 and retrain:");
    console.log("  ENABLE_RELATIVE_FEATURES=1 npm run train:ranker");
  } else {
    console.log("✗ FAIL — relative features did not improve walk-forward metrics.");
    console.log("  Keep core-only feature set; do not enable relative features.");
  }

  console.log("\nFold comparison (mean IC):");
  console.log(`${"Fold".padEnd(6)} ${"Core".padStart(8)} ${"+Relative".padStart(10)}`);
  for (let i = 0; i < baseline.folds.length; i++) {
    const bf = baseline.folds[i];
    const rf = withRelative.folds[i];
    console.log(
      `${String(bf.fold).padEnd(6)} ${fmt(bf.significance.meanIC).padStart(8)} ${fmt(rf?.significance.meanIC ?? 0).padStart(10)}`
    );
  }

  console.log("\nRelative feature keys:");
  withRelativeKeys.slice(coreKeys.length).forEach((k) => console.log(`  · ${k}`));
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
