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
  console.log("Collecting walk-forward samples (~2y OHLCV + sentiment)...");

  const samples = await collectWatchlistTrainingData(symbols, 500);
  console.log(`  Samples: ${samples.length}`);

  if (samples.length < 80) {
    console.log("\nNot enough samples to train (need ≥80). Try after more ingest/history.");
    process.exit(1);
  }

  const model = trainRidgeRanker(samples, {
    holdoutRatio: 0.25,
    tuneLambda: true,
    useRecencyWeights: true,
  });
  if (!model) {
    console.log("\nTraining failed — insufficient data after holdout split.");
    process.exit(1);
  }

  const outPath = getRankerModelPath();
  saveRankerModel(model, outPath);

  console.log(`\n── Model saved → ${outPath} ──\n`);
  console.log(`Type: v${model.version} cross-sectional ridge (λ=${model.ridgeLambda})`);
  console.log("\nTrain set:");
  console.log(`  Daily IC:  ${model.trainMetrics.ic.toFixed(3)}  (ranking metric)`);
  if (model.trainMetrics.pooledIc != null) {
    console.log(`  Pooled IC: ${model.trainMetrics.pooledIc.toFixed(3)}`);
  }
  console.log(`  DA:  ${(model.trainMetrics.directionalAccuracy * 100).toFixed(1)}%`);
  console.log(`  MAE: ${model.trainMetrics.mae.toFixed(3)}%`);
  console.log("\nHoldout set (honest estimate):");
  console.log(`  Daily IC:  ${model.holdoutMetrics.ic.toFixed(3)}  (research: 0.03–0.08 meaningful)`);
  if (model.holdoutMetrics.pooledIc != null) {
    console.log(`  Pooled IC: ${model.holdoutMetrics.pooledIc.toFixed(3)}`);
  }
  console.log(`  DA:  ${(model.holdoutMetrics.directionalAccuracy * 100).toFixed(1)}%`);
  console.log(`  MAE: ${model.holdoutMetrics.mae.toFixed(3)}%`);
  console.log("\nTop feature weights (standardized):");
  model.featureNames.forEach((name, i) => {
    console.log(`  ${name.padEnd(22)} ${model.weights[i] >= 0 ? "+" : ""}${model.weights[i].toFixed(4)}`);
  });
  console.log("\nSet RANKER_BLEND=0.25 in .env.local (default). Restart dev server.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
