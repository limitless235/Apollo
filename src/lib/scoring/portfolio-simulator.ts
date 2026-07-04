import type { OhlcvBar } from "@/lib/prices/yfinance";
import type { RankerModel } from "./ranker-model";
import { extractFeaturesAt, type RawFeatures, type SentimentDay } from "./features";
import { scoreFeatures } from "./composite";
import { predictRankerScoresBatch } from "./ranker-model";
import { blendRankScores, getScoringMode, type ScoringMode } from "./score-blend";
import { dailyIcSeries, icSignificance } from "./ic-stats";
import { spearman } from "./cross-sectional";
import { portfolioStats, rebalanceCostPct, getRoundTripCostPct } from "./portfolio-costs";

export type SimStrategy = "heuristic" | "learned" | "blend";

export interface PortfolioSimOptions {
  topK?: number;
  minHistory?: number;
  rebalanceEvery?: number;
  applyCosts?: boolean;
  strategy?: SimStrategy;
  scoringMode?: ScoringMode;
  mlWeight?: number;
  model?: RankerModel | null;
}

export interface PortfolioSimResult {
  strategy: SimStrategy;
  rebalanceEvery: number;
  days: number;
  ic: number;
  icSignificance: ReturnType<typeof icSignificance>;
  sharpe: number;
  cumulativeReturn: number;
  grossCumulativeReturn: number;
  maxDrawdown: number;
  avgDailyReturn: number;
  totalCostPct: number;
  roundTripCostPct: number;
}

function nextDayReturn(bars: OhlcvBar[], date: string): number | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0 || idx >= bars.length - 1) return null;
  const curr = bars[idx].close;
  const next = bars[idx + 1].close;
  if (curr <= 0) return null;
  return ((next - curr) / curr) * 100;
}

function scoreDay(
  day: Array<{ symbol: string; features: RawFeatures; nextRet: number }>,
  strategy: SimStrategy,
  model: RankerModel | null,
  mlWeight: number,
  scoringMode: ScoringMode
): Array<{ symbol: string; score: number; nextRet: number }> {
  const features = day.map((d) => d.features);
  const heuristicScores = features.map((f) => scoreFeatures(f).score);
  const learnedScores = predictRankerScoresBatch(features, model);

  if (strategy === "heuristic") {
    return day.map((d, i) => ({
      symbol: d.symbol,
      score: heuristicScores[i],
      nextRet: d.nextRet,
    }));
  }

  if (strategy === "learned") {
    return day.map((d, i) => ({
      symbol: d.symbol,
      score: learnedScores[i] ?? heuristicScores[i],
      nextRet: d.nextRet,
    }));
  }

  const blended = blendRankScores(heuristicScores, learnedScores, mlWeight, scoringMode);
  return day.map((d, i) => ({
    symbol: d.symbol,
    score: blended[i],
    nextRet: d.nextRet,
  }));
}

export function runPortfolioSimulation(
  seriesBySymbol: Map<string, OhlcvBar[]>,
  sentimentBySymbol: Map<string, SentimentDay[]>,
  options: PortfolioSimOptions = {}
): PortfolioSimResult {
  const topK = options.topK ?? 5;
  const minHistory = options.minHistory ?? 30;
  const rebalanceEvery = options.rebalanceEvery ?? 1;
  const applyCosts = options.applyCosts ?? true;
  const strategy = options.strategy ?? "blend";
  const model = options.model ?? null;
  const mlWeight = options.mlWeight ?? model?.mlWeight ?? 1;
  const scoringMode = options.scoringMode ?? getScoringMode();

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
  const datedForIc: Array<{ date: string; predicted: number; actual: number }> = [];

  let holdings: string[] = [];
  let totalCostPct = 0;
  let dayIdx = 0;

  for (const date of dates) {
    const day: Array<{ symbol: string; features: RawFeatures; nextRet: number }> = [];
    for (const symbol of symbols) {
      const bars = seriesBySymbol.get(symbol)!;
      const sentiment = sentimentBySymbol.get(symbol) ?? [];
      const features = extractFeaturesAt(bars, sentiment, date);
      if (!features) continue;
      const nextRet = nextDayReturn(bars, date);
      if (nextRet == null) continue;
      day.push({ symbol, features, nextRet });
    }
    if (day.length < topK) continue;

    const scored = scoreDay(day, strategy, model, mlWeight, scoringMode);
    scored.sort((a, b) => b.score - a.score);

    for (const s of scored) {
      allScores.push(s.score);
      allReturns.push(s.nextRet);
      datedForIc.push({ date, predicted: s.score, actual: s.nextRet });
    }

    const shouldRebalance = holdings.length === 0 || dayIdx % rebalanceEvery === 0;
    const activeSymbols = shouldRebalance
      ? scored.slice(0, topK).map((s) => s.symbol)
      : holdings;

    const activeReturns = shouldRebalance
      ? scored.slice(0, topK).map((s) => s.nextRet)
      : scored.filter((s) => activeSymbols.includes(s.symbol)).map((s) => s.nextRet);

    if (activeReturns.length === 0) continue;

    const gross = activeReturns.reduce((a, b) => a + b, 0) / activeReturns.length;
    grossReturns.push(gross);

    let cost = 0;
    if (applyCosts && shouldRebalance && holdings.length > 0) {
      cost = rebalanceCostPct(holdings, activeSymbols);
      totalCostPct += cost;
    } else if (applyCosts && holdings.length === 0) {
      cost = rebalanceCostPct([], activeSymbols);
      totalCostPct += cost;
    }

    netReturns.push(gross - cost);
    holdings = activeSymbols;
    dayIdx++;
  }

  const net = portfolioStats(netReturns);
  const gross = portfolioStats(grossReturns);
  const dailyICs = dailyIcSeries(datedForIc);

  return {
    strategy,
    rebalanceEvery,
    days: net.days,
    ic: spearman(allScores, allReturns),
    icSignificance: icSignificance(dailyICs),
    sharpe: net.sharpe,
    cumulativeReturn: net.cumulativeReturn,
    grossCumulativeReturn: gross.cumulativeReturn,
    maxDrawdown: net.maxDrawdown,
    avgDailyReturn: net.avgDailyReturn,
    totalCostPct,
    roundTripCostPct: getRoundTripCostPct(),
  };
}

/** Compare heuristic vs ML vs blend IC on the same dated feature rows. */
export function compareStrategyIC(
  seriesBySymbol: Map<string, OhlcvBar[]>,
  sentimentBySymbol: Map<string, SentimentDay[]>,
  model: RankerModel | null,
  minHistory = 30
): { heuristicIC: number; mlIC: number; blendIC: number } {
  const symbols = Array.from(seriesBySymbol.keys());
  const allDates = new Set<string>();
  for (const bars of seriesBySymbol.values()) {
    for (const b of bars) allDates.add(b.date);
  }
  const dates = Array.from(allDates).sort();

  const hDated: Array<{ date: string; predicted: number; actual: number }> = [];
  const mDated: Array<{ date: string; predicted: number; actual: number }> = [];
  const bDated: Array<{ date: string; predicted: number; actual: number }> = [];
  const mlWeight = model?.mlWeight ?? 1;

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
    if (day.length < 5) continue;

    const features = day.map((d) => d.features);
    const heuristicScores = features.map((f) => scoreFeatures(f).score);
    const learnedScores = predictRankerScoresBatch(features, model);
    const blended = blendRankScores(heuristicScores, learnedScores, mlWeight, "blend");

    day.forEach((d, i) => {
      const row = { date, predicted: 0, actual: d.nextRet };
      hDated.push({ ...row, predicted: heuristicScores[i] });
      mDated.push({ ...row, predicted: learnedScores[i] ?? 0 });
      bDated.push({ ...row, predicted: blended[i] });
    });
  }

  const hIC = icSignificance(dailyIcSeries(hDated)).meanIC;
  const mIC = icSignificance(dailyIcSeries(mDated)).meanIC;
  const bIC = icSignificance(dailyIcSeries(bDated)).meanIC;
  return { heuristicIC: hIC, mlIC: mIC, blendIC: bIC };
}
