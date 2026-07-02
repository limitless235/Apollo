import type { OhlcvBar } from "@/lib/prices/yfinance";
import type { SentimentDay } from "./features";
import { extractFeaturesAt } from "./features";
import { scoreFeatures } from "./composite";
import {
  applyTransactionCost,
  estimateDailyTurnover,
  getTxCostPct,
  portfolioStats,
} from "./portfolio-costs";

export interface BacktestDay {
  date: string;
  score: number;
  nextReturn: number;
  direction: "up" | "down" | "flat";
  predicted: "up" | "down" | "flat";
}

export interface BacktestMetrics {
  symbol: string;
  days: number;
  ic: number;
  directionalAccuracy: number;
  hitRateHighScore: number;
  avgNextReturnWhenBullish: number;
  avgNextReturnWhenBearish: number;
  timeline: BacktestDay[];
}

function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;

  function ranks(values: number[]): number[] {
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

function nextDayReturn(bars: OhlcvBar[], date: string): number | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0 || idx >= bars.length - 1) return null;
  const curr = bars[idx].close;
  const next = bars[idx + 1].close;
  if (curr <= 0) return null;
  return ((next - curr) / curr) * 100;
}

export function backtestSymbol(
  symbol: string,
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[] = [],
  minHistory = 30
): BacktestMetrics {
  const sorted = [...ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const timeline: BacktestDay[] = [];

  for (let i = minHistory; i < sorted.length - 1; i++) {
    const date = sorted[i].date;
    const features = extractFeaturesAt(sorted, sentimentTimeline, date);
    if (!features) continue;

    const nextRet = nextDayReturn(sorted, date);
    if (nextRet == null) continue;

    const { score } = scoreFeatures(features);
    const predicted: "up" | "down" | "flat" =
      score > 0.05 ? "up" : score < -0.05 ? "down" : "flat";
    const direction: "up" | "down" | "flat" =
      nextRet > 0.05 ? "up" : nextRet < -0.05 ? "down" : "flat";

    timeline.push({
      date,
      score,
      nextReturn: nextRet,
      direction,
      predicted,
    });
  }

  const scores = timeline.map((t) => t.score);
  const returns = timeline.map((t) => t.nextReturn);

  const ic = spearman(scores, returns);

  const directional = timeline.filter((t) => t.predicted !== "flat");
  const directionalAccuracy =
    directional.length > 0
      ? directional.filter((t) => t.predicted === t.direction).length / directional.length
      : 0;

  const highScore = timeline.filter((t) => t.score >= 0.1);
  const hitRateHighScore =
    highScore.length > 0
      ? highScore.filter((t) => t.nextReturn > 0).length / highScore.length
      : 0;

  const bullish = timeline.filter((t) => t.score >= 0.08);
  const bearish = timeline.filter((t) => t.score <= -0.08);

  return {
    symbol,
    days: timeline.length,
    ic,
    directionalAccuracy,
    hitRateHighScore,
    avgNextReturnWhenBullish:
      bullish.length > 0
        ? bullish.reduce((s, t) => s + t.nextReturn, 0) / bullish.length
        : 0,
    avgNextReturnWhenBearish:
      bearish.length > 0
        ? bearish.reduce((s, t) => s + t.nextReturn, 0) / bearish.length
        : 0,
    timeline,
  };
}

export interface PortfolioBacktestResult {
  days: number;
  topK: number;
  avgDailyReturn: number;
  cumulativeReturn: number;
  sharpe: number;
  maxDrawdown: number;
  benchmarkReturn: number;
  grossCumulativeReturn: number;
  txCostPct: number;
}

/** Equal-weight top-K by score vs hold-all benchmark (equal weight all symbols). */
export function backtestPortfolio(
  seriesBySymbol: Map<string, OhlcvBar[]>,
  sentimentBySymbol: Map<string, SentimentDay[]>,
  topK = 5,
  minHistory = 30,
  applyCosts = true
): PortfolioBacktestResult {
  const symbols = Array.from(seriesBySymbol.keys());
  if (symbols.length === 0) {
    return {
      days: 0,
      topK,
      avgDailyReturn: 0,
      cumulativeReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
      benchmarkReturn: 0,
      grossCumulativeReturn: 0,
      txCostPct: getTxCostPct(),
    };
  }

  const allDates = new Set<string>();
  for (const bars of seriesBySymbol.values()) {
    for (const b of bars) allDates.add(b.date);
  }
  const dates = Array.from(allDates).sort();

  const portfolioReturns: number[] = [];
  const grossReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  const txCost = getTxCostPct();

  for (const date of dates) {
    const scores: Array<{ symbol: string; score: number; nextRet: number }> = [];

    for (const symbol of symbols) {
      const bars = seriesBySymbol.get(symbol)!;
      const sentiment = sentimentBySymbol.get(symbol) ?? [];
      const features = extractFeaturesAt(bars, sentiment, date);
      if (!features) continue;
      const nextRet = nextDayReturn(bars, date);
      if (nextRet == null) continue;
      scores.push({ symbol, score: scoreFeatures(features).score, nextRet });
    }

    if (scores.length < topK) continue;

    scores.sort((a, b) => b.score - a.score);
    const topReturns = scores.slice(0, topK).map((s) => s.nextRet);
    const allReturns = scores.map((s) => s.nextRet);

    if (topReturns.length === 0) continue;

    const gross =
      topReturns.reduce((a, b) => a + b, 0) / topReturns.length;
    grossReturns.push(gross);

    const turnover = estimateDailyTurnover(topK, scores.length);
    const net = applyCosts
      ? applyTransactionCost(gross, turnover, txCost)
      : gross;
    portfolioReturns.push(net);
    benchmarkReturns.push(
      allReturns.reduce((a, b) => a + b, 0) / allReturns.length
    );
  }

  if (portfolioReturns.length === 0) {
    return {
      days: 0,
      topK,
      avgDailyReturn: 0,
      cumulativeReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
      benchmarkReturn: 0,
      grossCumulativeReturn: 0,
      txCostPct: getTxCostPct(),
    };
  }

  const netStats = portfolioStats(portfolioReturns);
  const grossStats = portfolioStats(grossReturns);
  const benchCumulative = benchmarkReturns.reduce(
    (acc, r) => acc * (1 + r / 100),
    1
  );

  return {
    days: netStats.days,
    topK,
    avgDailyReturn: netStats.avgDailyReturn,
    cumulativeReturn: netStats.cumulativeReturn,
    sharpe: netStats.sharpe,
    maxDrawdown: netStats.maxDrawdown,
    benchmarkReturn: (benchCumulative - 1) * 100,
    grossCumulativeReturn: grossStats.cumulativeReturn,
    txCostPct: txCost,
  };
}
