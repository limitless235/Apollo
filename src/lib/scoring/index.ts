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

import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv, fetchQuoteChange } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { extractFeatures } from "./features";
import { rankSignals, type SymbolSignal } from "./composite";

export async function computeWatchlistSignals(
  items: Array<{ symbol: string; companyName: string }>
): Promise<SymbolSignal[]> {
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

      const [ohlcv, timeline, changePercent] = await Promise.all([
        fetchOhlcv(entry.yfinanceTicker, 90),
        getSentimentTimeline(item.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
      ]);

      return {
        symbol: item.symbol,
        companyName: item.companyName,
        features: extractFeatures(ohlcv, timeline),
        changePercent,
      };
    })
  );

  return rankSignals(inputs);
}
