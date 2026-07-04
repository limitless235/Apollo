/**
 * Train ridge-linear ranker on walk-forward watchlist data.
 * Usage: npm run train:ranker
 */
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import {
  collectWatchlistTrainingData,
  trainRidgeRanker,
  saveRankerModel,
  getRankerModelPath,
} from "../src/lib/scoring";

async function main() {
  initDb();
  const symbols = await getWatchlistSymbols();

  if (symbols.length < 5) {
    console.log("Need at least 5 watchlist symbols. Run: npm run db:seed");
    process.exit(1);
  }

  console.log(`\nApollo Ranker Training — ${symbols.length} symbols\n`);
  console.log("Collecting walk-forward samples (~2y OHLCV + sentiment, 5d forward target)...");

  const samples = await collectWatchlistTrainingData(symbols, 500, 5);
  console.log(`  Samples: ${samples.length}`);

  if (samples.length < 80) {
    console.log("\nNot enough samples to train (need ≥80). Try after more ingest/history.");
    process.exit(1);
  }

  const model = trainRidgeRanker(samples, {
    tuneLambda: true,
    useRecencyWeights: true,
    forwardDays: 5,
    targetType: "rank",
    nFolds: 6,
    logFolds: true,
  });
  if (!model) {
    console.log("\nTraining failed — insufficient data after walk-forward split.");
    process.exit(1);
  }

  const outPath = getRankerModelPath();
  saveRankerModel(model, outPath);

  console.log(`\n── Model saved → ${outPath} ──\n`);
  console.log(`Type: v${model.version} cross-sectional ridge (λ=${model.ridgeLambda})`);
  console.log(`Target: ${model.targetType ?? "excess"} · ${model.forwardDays ?? 1}d forward`);
  console.log(`Features: ${model.featureNames.length}`);
  console.log(
    `Blend weights: ML ${((model.mlWeight ?? 0) * 100).toFixed(0)}% / heuristic ${((model.heuristicWeight ?? 0) * 100).toFixed(0)}%`
  );
  console.log(`  (from walk-forward IC: heuristic ${(model.heuristicIC ?? 0).toFixed(3)}, ML ${(model.mlIC ?? 0).toFixed(3)})`);

  if (model.icSignificance) {
    const s = model.icSignificance;
    console.log("\nWalk-forward aggregate:");
    console.log(`  Mean IC:  ${s.meanIC.toFixed(3)}`);
    console.log(`  IC IR:    ${s.icIR.toFixed(3)}  (stability — higher is better)`);
    console.log(`  t-stat:   ${s.tStat.toFixed(2)}  (${s.nDays} independent test days)`);
    if (Math.abs(s.tStat) < 2) {
      console.log("  ⚠ t-stat < 2 — cannot reject null hypothesis (signal may be noise)");
    }
  }

  if (model.walkForwardFolds?.length) {
    console.log("\nFold-by-fold holdout:");
    for (const f of model.walkForwardFolds) {
      console.log(
        `  Fold ${f.fold} (${f.testStart} → ${f.testEnd}): IC ${f.meanIC.toFixed(3)} · IR ${f.icIR.toFixed(2)} · t=${f.tStat.toFixed(2)} · ${f.nDays}d`
      );
    }
  }

  console.log("\nTop feature weights (standardized):");
  model.featureNames.forEach((name, i) => {
    console.log(`  ${name.padEnd(22)} ${model.weights[i] >= 0 ? "+" : ""}${model.weights[i].toFixed(4)}`);
  });

  console.log("\nSet SCORING_MODE=blend|ml_only|heuristic_only in .env.local");
  console.log("Re-train weekly: npm run ingest && npm run train:ranker\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
