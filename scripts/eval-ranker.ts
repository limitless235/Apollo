/**
 * Compare heuristic vs learned ranker vs blend (with transaction costs).
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
  predictRankerScoresBatch,
  blendScores,
  getEffectiveRankerBlend,
  getTxCostPct,
  type SentimentDay,
  type RawFeatures,
} from "../src/lib/scoring";
import type { RankerModel } from "../src/lib/scoring/ranker-model";
import {
  applyTransactionCost,
  estimateDailyTurnover,
  portfolioStats,
} from "../src/lib/scoring/portfolio-costs";
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
  mode: "heuristic" | "learned" | "blended",
  model: RankerModel | null,
  effectiveBlend: number,
  topK = 5,
  minHistory = 30
) {
  const symbols = Array.from(seriesBySymbol.keys());
  const allDates = new Set<string>();
  for (const bars of seriesBySymbol.values()) {
    for (const b of bars) allDates.add(b.date);
  }
  const dates = Array.from(allDates).sort();
  const netReturns: number[] = [];
  const grossReturns: number[] = [];
  const allScores: number[] = [];
  const allReturns: number[] = [];
  const txCost = getTxCostPct();

  for (const date of dates) {
    const day: Array<{ features: RawFeatures; nextRet: number }> = [];
    for (const symbol of symbols) {
      const bars = seriesBySymbol.get(symbol)!;
      const sentiment = sentimentBySymbol.get(symbol) ?? [];
      const features = extractFeaturesAt(bars, sentiment, date);
      if (!features) continue;
      const nextRet = nextDayReturn(bars, date);
      if (nextRet == null) continue;
      day.push({ features, nextRet });
    }
    if (day.length < topK) continue;

    const features = day.map((d) => d.features);
    const heuristicScores = features.map((f) => scoreFeatures(f).score);
    const learnedScores = predictRankerScoresBatch(features, model);

    const scores = day.map((_, i) => {
      if (mode === "heuristic") return heuristicScores[i];
      if (mode === "learned") return learnedScores[i] ?? heuristicScores[i];
      return blendScores(heuristicScores[i], learnedScores[i], effectiveBlend).score;
    });

    const ranked = scores.map((score, i) => ({ score, nextRet: day[i].nextRet }));
    ranked.sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, topK);
    const gross = top.reduce((s, d) => s + d.nextRet, 0) / top.length;
    grossReturns.push(gross);
    const turnover = estimateDailyTurnover(topK, ranked.length);
    netReturns.push(applyTransactionCost(gross, turnover, txCost));
    for (const d of ranked) {
      allScores.push(d.score);
      allReturns.push(d.nextRet);
    }
  }

  const net = portfolioStats(netReturns);
  const gross = portfolioStats(grossReturns);

  return {
    days: net.days,
    ic: spearman(allScores, allReturns),
    sharpe: net.sharpe,
    cumulativeReturn: net.cumulativeReturn,
    grossCumulativeReturn: gross.cumulativeReturn,
    avgDailyReturn: net.avgDailyReturn,
  };
}

async function main() {
  initDb();
  const model = loadRankerModel(true);
  const symbols = await getWatchlistSymbols();
  const effectiveBlend = getEffectiveRankerBlend(model);

  console.log(`\nApollo Ranker Evaluation — ${symbols.length} symbols\n`);
  if (!model) {
    console.log("No ranker model found. Run: npm run train:ranker\n");
    process.exit(1);
  }

  console.log(`Model trained: ${model.trainedAt.slice(0, 10)} (${model.sampleCount} samples)`);
  console.log(
    `Holdout daily IC: ${model.holdoutMetrics.ic.toFixed(3)} · DA: ${(model.holdoutMetrics.directionalAccuracy * 100).toFixed(1)}%`
  );
  if (model.crossSectional) {
    console.log(`Mode: v${model.version} cross-sectional · λ=${model.ridgeLambda}`);
  }
  console.log(`Effective ML blend: ${(effectiveBlend * 100).toFixed(0)}% · Tx cost: ${getTxCostPct()}%/turnover\n`);
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

  const heuristic = portfolioSim(
    seriesBySymbol,
    sentimentBySymbol,
    "heuristic",
    model,
    effectiveBlend
  );
  const learned = portfolioSim(
    seriesBySymbol,
    sentimentBySymbol,
    "learned",
    model,
    effectiveBlend
  );
  const blended = portfolioSim(
    seriesBySymbol,
    sentimentBySymbol,
    "blended",
    model,
    effectiveBlend
  );

  console.log("\n── Top-5 portfolio (net of tx costs) ──\n");
  console.log(
    "Strategy".padEnd(14) +
      "IC".padStart(8) +
      "Sharpe".padStart(10) +
      "NetRet%".padStart(10) +
      "GrossRet%".padStart(11)
  );
  console.log("-".repeat(53));

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
        r.grossCumulativeReturn.toFixed(2).padStart(11)
    );
  }

  console.log("\nRe-train weekly: npm run ingest && npm run train:ranker\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
