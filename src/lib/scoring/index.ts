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
  featuresToVector,
  returnToScore,
} from "./feature-vector";
export {
  loadRankerModel,
  saveRankerModel,
  predictRankerScore,
  predictRankerScoresBatch,
  predictReturnsBatch,
  predictReturn,
  getRankerBlend,
  getEffectiveRankerBlend,
  blendScores,
  getRankerModelPath,
} from "./ranker-model";
export type { RankerModel, RankerMetrics } from "./ranker-model";
export { trainRidgeRanker, type TrainingSample } from "./train-ridge";
export { collectWatchlistTrainingData, buildSamplesFromSeries } from "./dataset";
export { getTxCostPct, applyTransactionCost, estimateDailyTurnover } from "./portfolio-costs";

import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv, fetchQuoteChange } from "@/lib/prices/yfinance";
import { getSentimentTimeline, getSentimentMlCoverage } from "@/lib/news/rss-fetcher";
import { extractFeatures } from "./features";
import { rankSignals, type SymbolSignal } from "./composite";
import { loadRankerModel, getRankerBlend, getEffectiveRankerBlend } from "./ranker-model";

export async function computeWatchlistSignals(
  items: Array<{ symbol: string; companyName: string }>
): Promise<SymbolSignal[]> {
  const rankerModel = loadRankerModel();

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
        fetchOhlcv(entry.yfinanceTicker, 90),
        getSentimentTimeline(item.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
        getSentimentMlCoverage(item.symbol, 7),
      ]);

      return {
        symbol: item.symbol,
        companyName: item.companyName,
        features: extractFeatures(ohlcv, timeline, mlCoverage),
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
    blend: getRankerBlend(),
    effectiveBlend: getEffectiveRankerBlend(model),
    trainHint: active
      ? null
      : "Run npm run train:ranker locally to enable ML-ranked watchlist",
  };
}
