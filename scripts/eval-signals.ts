/**
 * Walk-forward signal evaluation for the watchlist.
 * Usage: npm run eval:signals
 */
import { initDb } from "../src/lib/db";
import { getWatchlist } from "../src/lib/watchlist";
import { getSymbolEntry } from "../src/lib/symbols/registry";
import { fetchOhlcv } from "../src/lib/prices/yfinance";
import { getSentimentTimeline } from "../src/lib/news/rss-fetcher";
import {
  backtestSymbol,
  backtestPortfolio,
  type BacktestMetrics,
} from "../src/lib/scoring";

async function main() {
  initDb();
  const watchlist = await getWatchlist();

  if (watchlist.length === 0) {
    console.log("Watchlist empty. Run: npm run db:seed");
    process.exit(1);
  }

  console.log(`\nApollo Signal Evaluation — ${watchlist.length} symbols\n`);
  console.log("Fetching 1y OHLCV + sentiment (this may take a minute)...\n");

  const seriesBySymbol = new Map<string, Awaited<ReturnType<typeof fetchOhlcv>>>();
  const sentimentBySymbol = new Map<
    string,
    Awaited<ReturnType<typeof getSentimentTimeline>>
  >();
  const results: BacktestMetrics[] = [];

  for (const item of watchlist) {
    const entry = getSymbolEntry(item.symbol);
    if (!entry) continue;

    process.stdout.write(`  ${item.symbol}...`);
    const [ohlcv, timeline] = await Promise.all([
      fetchOhlcv(entry.yfinanceTicker, 365),
      getSentimentTimeline(item.symbol, 365),
    ]);

    seriesBySymbol.set(item.symbol, ohlcv);
    sentimentBySymbol.set(item.symbol, timeline);

    const metrics = backtestSymbol(item.symbol, ohlcv, timeline);
    results.push(metrics);
    console.log(
      ` IC=${metrics.ic.toFixed(3)} DA=${(metrics.directionalAccuracy * 100).toFixed(1)}%`
    );
  }

  const topK = Math.min(5, watchlist.length);
  const portfolio = backtestPortfolio(seriesBySymbol, sentimentBySymbol, topK);

  console.log("\n── Per-symbol (1y walk-forward, next-day return) ──\n");
  console.log(
    "Symbol".padEnd(12) +
      "Days".padStart(6) +
      "IC".padStart(8) +
      "DA%".padStart(8) +
      "Hit@Bull".padStart(10) +
      "AvgRet+".padStart(10) +
      "AvgRet-".padStart(10)
  );
  console.log("-".repeat(64));

  for (const r of results.sort((a, b) => b.ic - a.ic)) {
    console.log(
      r.symbol.padEnd(12) +
        String(r.days).padStart(6) +
        r.ic.toFixed(3).padStart(8) +
        (r.directionalAccuracy * 100).toFixed(1).padStart(8) +
        (r.hitRateHighScore * 100).toFixed(1).padStart(10) +
        r.avgNextReturnWhenBullish.toFixed(2).padStart(10) +
        r.avgNextReturnWhenBearish.toFixed(2).padStart(10)
    );
  }

  const avgIc = results.reduce((s, r) => s + r.ic, 0) / Math.max(results.length, 1);
  const avgDa =
    results.reduce((s, r) => s + r.directionalAccuracy, 0) / Math.max(results.length, 1);

  console.log("\n── Portfolio simulation (top-" + topK + " by score, equal weight) ──\n");
  console.log(`  Days evaluated:     ${portfolio.days}`);
  console.log(`  Cumulative return:  ${portfolio.cumulativeReturn.toFixed(2)}%`);
  console.log(`  Benchmark (all):    ${portfolio.benchmarkReturn.toFixed(2)}%`);
  console.log(`  Sharpe (approx):    ${portfolio.sharpe.toFixed(2)}`);
  console.log(`  Max drawdown:       ${portfolio.maxDrawdown.toFixed(2)}%`);
  console.log(`  Avg daily return:   ${portfolio.avgDailyReturn.toFixed(3)}%`);

  console.log("\n── Summary ──\n");
  console.log(`  Mean IC:  ${avgIc.toFixed(3)}  (research: 0.03–0.08 is meaningful)`);
  console.log(`  Mean DA:  ${(avgDa * 100).toFixed(1)}%  (research: 52–58% is realistic)`);
  console.log("\nNote: No transaction costs applied. IC/DA vary by regime.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
