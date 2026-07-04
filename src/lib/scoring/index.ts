export { extractFeatures, extractFeaturesAt } from "./features";
export type { RawFeatures, SentimentDay } from "./features";
export {
  scoreFeatures,
  signalLabel,
  rankSignals,
} from "./composite";
export type { SymbolSignal, FeatureContribution, SignalLabel } from "./composite";
export { backtestSymbol, backtestPortfolio } from "./backtest";
export type { BacktestMetrics, PortfolioBacktestResult } from "./backtest";
export {
  RANKER_FEATURE_KEYS,
  getActiveRankerFeatureKeys,
  featureKeysForGroups,
  CORE_RANKER_FEATURE_KEYS,
  RELATIVE_FEATURE_KEYS,
  featuresToVector,
  returnToScore,
} from "./feature-vector";
export { loadBenchmarkSeries, type BenchmarkSeriesCache } from "./dataset";
export type { FeatureGroup } from "./feature-vector";
export {
  loadRankerModel,
  saveRankerModel,
  predictRankerScore,
  predictRankerScoresBatch,
  predictReturnsBatch,
  predictReturn,
  getRankerBlend,
  getEffectiveRankerBlend,
  getMlWeight,
  blendScores,
  getRankerModelPath,
} from "./ranker-model";
export type { RankerModel, RankerMetrics } from "./ranker-model";
export { trainRidgeRanker, type TrainingSample } from "./train-ridge";
export { collectWatchlistTrainingData, buildSamplesFromSeries, forwardReturn } from "./dataset";
export {
  runWalkForwardValidation,
  evaluateHoldoutSplit,
  runSingleHoldoutEval,
  printWalkForwardFoldTable,
  foldMetricsToTableRow,
  predictHoldoutTest,
} from "./walk-forward";
export type { WalkForwardResult, WalkForwardOptions } from "./walk-forward";
export {
  countSignFlips,
  dailyIcStd,
  labelPurgeGapDays,
  trainEndWithLabelPurge,
} from "./walk-forward-logging";
export type { FoldTableRow } from "./walk-forward-logging";
export {
  prepareCrossSectionalSamples,
  crossSectionalZScoreRows,
  MIN_CROSS_SECTION,
} from "./cross-sectional";
export { evaluateAcceptanceBar, type AcceptanceBarResult } from "./acceptance-bar";
export {
  runSubsetWalkForwardEval,
  runPooledFeatureIc,
  printSubsetFoldTable,
  type SubsetEvalResult,
} from "./subset-eval";
export { getScoringMode, computeBlendWeight, blendRankScores, type ScoringMode } from "./score-blend";
export { icSignificance, dailyIcSeries, type IcSignificance } from "./ic-stats";
export { runPortfolioSimulation, compareStrategyIC } from "./portfolio-simulator";
export {
  generateTradeRecommendation,
  type TradeRecommendation,
  type TradeAction,
  type RecommendationInput,
} from "./recommendation";
export {
  loadEarningsOverlay,
  saveEarningsOverlay,
  isEarningsOverlayEnabled,
  applyOverlay,
  fitEarningsOverlay,
  runOverlayWalkForwardEval,
  OVERLAY_ADJUSTMENT_CAP,
  type EarningsOverlay,
} from "./earnings-overlay";
export {
  runPostEarningsOutlierAudit,
  printOutlierAudit,
  type OutlierAuditResult,
} from "./earnings-audit";

import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv, fetchQuoteChange } from "@/lib/prices/yfinance";
import { loadMarketBenchmark, loadSectorBenchmarks } from "@/lib/prices/benchmarks";
import { getSentimentTimeline, getSentimentMlCoverage } from "@/lib/news/rss-fetcher";
import { extractFeatures } from "./features";
import { benchmarkSnapshotAt } from "./benchmark-features";
import { getSectorId } from "./sector-mapping";
import { loadEarningsBySymbols } from "@/lib/earnings/store";
import { rankSignals, type SymbolSignal } from "./composite";
import { loadRankerModel, getRankerBlend, getMlWeight } from "./ranker-model";

export async function computeWatchlistSignals(
  items: Array<{ symbol: string; companyName: string }>
): Promise<SymbolSignal[]> {
  const rankerModel = loadRankerModel();

  const [marketBars, sectorMap, earningsMap] = await Promise.all([
    loadMarketBenchmark(365),
    loadSectorBenchmarks(365),
    loadEarningsBySymbols(items.map((i) => i.symbol)),
  ]);

  const inputs = await Promise.all(
    items.map(async (item) => {
      const entry = getSymbolEntry(item.symbol);
      if (!entry) {
        return {
          symbol: item.symbol,
          companyName: item.companyName,
          features: extractFeatures([]),
          changePercent: 0,
        };
      }

      const [ohlcv, timeline, changePercent, mlCoverage] = await Promise.all([
        fetchOhlcv(entry.yfinanceTicker, 365),
        getSentimentTimeline(item.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
        getSentimentMlCoverage(item.symbol, 7),
      ]);

      const asOfDate = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].date : "";
      const sectorId = getSectorId(item.symbol);
      const sectorBars = sectorId ? sectorMap.get(sectorId) : null;
      const market = asOfDate ? benchmarkSnapshotAt(marketBars, asOfDate) : null;
      const sector =
        asOfDate && sectorBars ? benchmarkSnapshotAt(sectorBars, asOfDate) : null;

      const earningsEvents = earningsMap.get(item.symbol.toUpperCase()) ?? [];

      return {
        symbol: item.symbol,
        companyName: item.companyName,
        features: extractFeatures(ohlcv, timeline, mlCoverage, { market, sector }, earningsEvents, asOfDate),
        changePercent,
      };
    })
  );

  return rankSignals(inputs, rankerModel);
}

export function getRankerStatus() {
  const model = loadRankerModel();
  const active = model != null;
  return {
    active,
    crossSectional: model?.crossSectional ?? false,
    version: model?.version ?? null,
    trainedAt: model?.trainedAt ?? null,
    sampleCount: model?.sampleCount ?? 0,
    holdoutIc: model?.holdoutMetrics.ic ?? null,
    holdoutPooledIc: model?.holdoutMetrics.pooledIc ?? null,
    holdoutDa: model?.holdoutMetrics.directionalAccuracy ?? null,
    ridgeLambda: model?.ridgeLambda ?? null,
    forwardDays: model?.forwardDays ?? null,
    targetType: model?.targetType ?? null,
    featureCount: model?.featureNames.length ?? 0,
    mlWeight: model?.mlWeight ?? null,
    icIR: model?.icSignificance?.icIR ?? null,
    icTStat: model?.icSignificance?.tStat ?? null,
    blend: getRankerBlend(),
    effectiveBlend: getMlWeight(model),
    trainHint: active
      ? null
      : "Run npm run train:ranker locally to enable ML-ranked watchlist",
  };
}
