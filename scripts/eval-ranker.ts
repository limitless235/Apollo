/**
 * Compare heuristic vs learned ranker vs blend (with transaction costs).
 * Usage: npm run eval:ranker
 */
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import { getSymbolEntry } from "../src/lib/symbols/registry";
import { fetchOhlcv } from "../src/lib/prices/yfinance";
import { getSentimentTimeline } from "../src/lib/news/rss-fetcher";
import type { SentimentDay } from "../src/lib/scoring/features";
import {
  loadRankerModel,
  getMlWeight,
} from "../src/lib/scoring";
import { getRoundTripCostPct } from "../src/lib/scoring/portfolio-costs";
import { runPortfolioSimulation, compareStrategyIC } from "../src/lib/scoring/portfolio-simulator";
import { getScoringMode } from "../src/lib/scoring/score-blend";
import type { OhlcvBar } from "../src/lib/prices/yfinance";

const REBALANCE_FREQS = [1, 3, 5] as const;

async function main() {
  initDb();
  const model = loadRankerModel(true);
  const symbols = await getWatchlistSymbols();

  console.log(`\nApollo Ranker Evaluation — ${symbols.length} symbols\n`);
  if (!model) {
    console.log("No ranker model found. Run: npm run train:ranker\n");
    process.exit(1);
  }

  const mlWeight = getMlWeight(model);
  const scoringMode = getScoringMode();
  const rtCost = getRoundTripCostPct();

  console.log(`Model: v${model.version} · trained ${model.trainedAt.slice(0, 10)}`);
  console.log(`Forward target: ${model.forwardDays ?? "?"}d ${model.targetType ?? "excess"}`);
  if (model.icSignificance) {
    const s = model.icSignificance;
    console.log(
      `Walk-forward IC: ${s.meanIC.toFixed(3)} · IR ${s.icIR.toFixed(2)} · t=${s.tStat.toFixed(2)} (${s.nDays} days)`
    );
    if (Math.abs(s.tStat) < 2) {
      console.log("  ⚠ t-stat < 2 — signal may be indistinguishable from noise");
    }
  }
  console.log(`Blend: ML ${(mlWeight * 100).toFixed(0)}% / heuristic ${((1 - mlWeight) * 100).toFixed(0)}% · mode=${scoringMode}`);
  console.log(`Round-trip cost: ${rtCost.toFixed(3)}% per full rebalance\n`);
  console.log("Fetching 1y data...\n");

  const seriesBySymbol = new Map<string, OhlcvBar[]>();
  const sentimentBySymbol = new Map<string, SentimentDay[]>();

  for (const symbol of symbols) {
    const entry = getSymbolEntry(symbol);
    if (!entry) continue;
    process.stdout.write(`  ${symbol}...`);
    const [ohlcv, timeline] = await Promise.all([
      fetchOhlcv(entry.yfinanceTicker, 365),
      getSentimentTimeline(symbol, 365),
    ]);
    seriesBySymbol.set(symbol, ohlcv);
    sentimentBySymbol.set(symbol, timeline);
    console.log(` ${ohlcv.length} bars`);
  }

  const icCompare = compareStrategyIC(seriesBySymbol, sentimentBySymbol, model);
  console.log("\n── Strategy IC (daily, walk-forward style on 1y data) ──");
  console.log(`  Heuristic: ${icCompare.heuristicIC.toFixed(3)}`);
  console.log(`  ML only:   ${icCompare.mlIC.toFixed(3)}`);
  console.log(`  Blended:   ${icCompare.blendIC.toFixed(3)}`);

  console.log("\n── Top-5 portfolio (gross vs net of NSE costs) ──\n");

  for (const freq of REBALANCE_FREQS) {
    console.log(`Rebalance every ${freq} day(s):`);
    console.log(
      "Strategy".padEnd(14) +
        "IC".padStart(8) +
        "Sharpe".padStart(10) +
        "NetRet%".padStart(10) +
        "GrossRet%".padStart(11) +
        "MaxDD%".padStart(10)
    );
    console.log("-".repeat(63));

    for (const strategy of ["heuristic", "learned", "blend"] as const) {
      const r = runPortfolioSimulation(seriesBySymbol, sentimentBySymbol, {
        strategy,
        rebalanceEvery: freq,
        applyCosts: true,
        model,
        mlWeight,
        scoringMode,
      });
      console.log(
        strategy.padEnd(14) +
          r.ic.toFixed(3).padStart(8) +
          r.sharpe.toFixed(2).padStart(10) +
          r.cumulativeReturn.toFixed(2).padStart(10) +
          r.grossCumulativeReturn.toFixed(2).padStart(11) +
          r.maxDrawdown.toFixed(1).padStart(10)
      );
    }
    console.log("");
  }

  console.log("Note: backtest uses today's watchlist projected over history (survivorship bias).");
  console.log("Re-train: npm run ingest && npm run train:ranker\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
