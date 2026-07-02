/**
 * Print current watchlist signal ranks.
 * Usage: npm run show:ranks
 */
import { initDb } from "../src/lib/db";
import { getWatchlist } from "../src/lib/watchlist";
import {
  computeWatchlistSignals,
  getRankerStatus,
  loadRankerModel,
  getEffectiveRankerBlend,
} from "../src/lib/scoring";

async function main() {
  initDb();
  const watchlist = await getWatchlist();
  const signals = await computeWatchlistSignals(watchlist);
  const ranker = getRankerStatus();
  const model = loadRankerModel();

  console.log(`\nApollo Watchlist Ranks — ${signals.length} symbols\n`);
  console.log(
    `Ranker: ${ranker.active ? "active" : "off"} · effective blend ${((ranker.effectiveBlend ?? 0) * 100).toFixed(0)}%`
  );
  if (model) {
    console.log(
      `Holdout daily IC ${model.holdoutMetrics.ic.toFixed(3)} · v${model.version}${model.crossSectional ? " CS" : ""} · trained ${model.trainedAt.slice(0, 10)}\n`
    );
  } else {
    console.log("Run: npm run train:ranker\n");
  }

  console.log(
    "Rank".padEnd(6) +
      "Symbol".padEnd(14) +
      "Score".padStart(8) +
      "Heur".padStart(8) +
      "ML".padStart(8) +
      "Label".padStart(16) +
      "  Flags"
  );
  console.log("-".repeat(72));

  for (const s of signals.slice(0, 15)) {
    const ml =
      s.learnedScore != null
        ? (s.learnedScore >= 0 ? "+" : "") + s.learnedScore.toFixed(2)
        : "—";
    const flags = s.flags.slice(0, 2).join(", ") || "—";
    console.log(
      `#${s.rank}`.padEnd(6) +
        s.symbol.padEnd(14) +
        (s.score >= 0 ? "+" : "") +
        s.score.toFixed(2).padStart(7) +
        (s.heuristicScore >= 0 ? "+" : "") +
        s.heuristicScore.toFixed(2).padStart(7) +
        ml.padStart(8) +
        s.label.padStart(16) +
        "  " +
        flags
    );
  }

  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
