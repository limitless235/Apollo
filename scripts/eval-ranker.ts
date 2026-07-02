/**
 * Compare heuristic vs learned ranker vs blend on walk-forward portfolio metrics.
 * Usage: npm run eval:ranker
 */
import { initDb } from "../src/lib/db";
import { getWatchlistSymbols } from "../src/lib/watchlist";
import { getSymbolEntry } from "../src/lib/symbols/registry";
import { fetchOhlcv } from "../src/lib/prices/yfinance";
import { getSentimentTimeline } from "../src/lib/news/rss-fetcher";
import {
  extractFeaturesAt,
  scoreFeatures,
  loadRankerModel,
  predictReturn,
  returnToScore,
  blendScores,
  type SentimentDay,
  type RawFeatures,
} from "../src/lib/scoring";
import type { OhlcvBar } from "../src/lib/prices/yfinance";

function nextDayReturn(bars: OhlcvBar[], date: string): number | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0 || idx >= bars.length - 1) return null;
  const curr = bars[idx].close;
  const next = bars[idx + 1].close;
  if (curr <= 0) return null;
  return ((next - curr) / curr) * 100;
}

function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  function ranks(values: number[]) {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const result = new Array<number>(values.length);
    indexed.forEach((item, rank) => {
      result[item.i] = rank + 1;
    });
    return result;
  }
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function portfolioSim(
  seriesBySymbol: Map<string, OhlcvBar[]>,
  sentimentBySymbol: Map<string, SentimentDay[]>,
  scoreFn: (features: RawFeatures) => number,
  topK = 5,
  minHistory = 30
) {
  const symbols = Array.from(seriesBySymbol.keys());
  const allDates = new Set<string>();
  for (const bars of seriesBySymbol.values()) {
    for (const b of bars) allDates.add(b.date);
  }
  const dates = Array.from(allDates).sort();
  const portfolioReturns: number[] = [];
  const allScores: number[] = [];
  const allReturns: number[] = [];

  for (const date of dates) {
    const day: Array<{ score: number; nextRet: number }> = [];
    for (const symbol of symbols) {
      const bars = seriesBySymbol.get(symbol)!;
      const sentiment = sentimentBySymbol.get(symbol) ?? [];
      const features = extractFeaturesAt(bars, sentiment, date);
      if (!features) continue;
      const nextRet = nextDayReturn(bars, date);
      if (nextRet == null) continue;
      day.push({ score: scoreFn(features), nextRet });
    }
    if (day.length < topK) continue;
    day.sort((a, b) => b.score - a.score);
    const top = day.slice(0, topK);
    portfolioReturns.push(top.reduce((s, d) => s + d.nextRet, 0) / top.length);
    for (const d of day) {
      allScores.push(d.score);
      allReturns.push(d.nextRet);
    }
  }

  const mean =
    portfolioReturns.reduce((a, b) => a + b, 0) / Math.max(portfolioReturns.length, 1);
  const variance =
    portfolioReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    Math.max(portfolioReturns.length - 1, 1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  const cumulative = portfolioReturns.reduce((acc, r) => acc * (1 + r / 100), 1);

  return {
    days: portfolioReturns.length,
    ic: spearman(allScores, allReturns),
    sharpe,
    cumulativeReturn: (cumulative - 1) * 100,
    avgDailyReturn: mean,
  };
}

async function main() {
  initDb();
  const model = loadRankerModel(true);
  const symbols = await getWatchlistSymbols();

  console.log(`\nApollo Ranker Evaluation — ${symbols.length} symbols\n`);
  if (!model) {
    console.log("No ranker model found. Run: npm run train:ranker\n");
    process.exit(1);
  }

  console.log(`Model trained: ${model.trainedAt.slice(0, 10)} (${model.sampleCount} samples)`);
  console.log(`Holdout IC: ${model.holdoutMetrics.ic.toFixed(3)} · DA: ${(model.holdoutMetrics.directionalAccuracy * 100).toFixed(1)}%\n`);
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
    console.log(" ok");
  }

  const heuristic = portfolioSim(seriesBySymbol, sentimentBySymbol, (f) =>
    scoreFeatures(f).score
  );
  const learned = portfolioSim(seriesBySymbol, sentimentBySymbol, (f) =>
    returnToScore(predictReturn(f, model))
  );
  const blended = portfolioSim(seriesBySymbol, sentimentBySymbol, (f) => {
    const h = scoreFeatures(f).score;
    const l = returnToScore(predictReturn(f, model));
    return blendScores(h, l).score;
  });

  console.log("\n── Top-5 equal-weight portfolio (walk-forward) ──\n");
  console.log(
    "Strategy".padEnd(14) +
      "IC".padStart(8) +
      "Sharpe".padStart(10) +
      "CumRet%".padStart(10) +
      "AvgDay%".padStart(10)
  );
  console.log("-".repeat(52));

  for (const [name, r] of [
    ["Heuristic", heuristic],
    ["Learned", learned],
    ["Blended", blended],
  ] as const) {
    console.log(
      name.padEnd(14) +
        r.ic.toFixed(3).padStart(8) +
        r.sharpe.toFixed(2).padStart(10) +
        r.cumulativeReturn.toFixed(2).padStart(10) +
        r.avgDailyReturn.toFixed(3).padStart(10)
    );
  }

  console.log("\nNote: No transaction costs. Re-train weekly: npm run train:ranker\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
