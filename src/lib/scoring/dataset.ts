import type { OhlcvBar } from "@/lib/prices/yfinance";
import { loadMarketBenchmark, loadSectorBenchmarks } from "@/lib/prices/benchmarks";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { extractFeaturesAt, type SentimentDay } from "./features";
import { mlCoverageForSymbolWindow, initArticleCoverageCache } from "./article-coverage";
import { getSectorId } from "./sector-mapping";
import { loadEarningsBySymbols } from "@/lib/earnings/store";
import type { EarningsEventRecord } from "@/lib/earnings/types";

export interface BenchmarkSeriesCache {
  market: OhlcvBar[];
  sectors: Map<string, OhlcvBar[]>;
}

export async function loadBenchmarkSeries(days = 500): Promise<BenchmarkSeriesCache> {
  const [market, sectors] = await Promise.all([
    loadMarketBenchmark(days),
    loadSectorBenchmarks(days),
  ]);
  return { market, sectors };
}

function sectorBarsForSymbol(
  cache: BenchmarkSeriesCache,
  symbol: string
): OhlcvBar[] | null {
  const sectorId = getSectorId(symbol);
  if (!sectorId) return null;
  return cache.sectors.get(sectorId) ?? null;
}

function nextDayReturn(bars: OhlcvBar[], date: string): number | null {
  return forwardReturn(bars, date, 1);
}

/** Forward return over N trading days from `date`. */
export function forwardReturn(
  bars: OhlcvBar[],
  date: string,
  days: number
): number | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0 || idx + days >= bars.length) return null;
  const curr = bars[idx].close;
  const future = bars[idx + days].close;
  if (curr <= 0) return null;
  return ((future - curr) / curr) * 100;
}

export function buildSamplesFromSeries(
  symbol: string,
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[] = [],
  minHistory = 60,
  useArticleMlCoverage = true,
  forwardDays = 5,
  benchmarkCache?: BenchmarkSeriesCache,
  earningsEvents: EarningsEventRecord[] = []
): TrainingSample[] {
  const sorted = [...ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const samples: TrainingSample[] = [];
  const benchmarkSeries = benchmarkCache
    ? {
        market: benchmarkCache.market,
        sector: sectorBarsForSymbol(benchmarkCache, symbol),
      }
    : {};

  for (let i = minHistory; i < sorted.length - forwardDays; i++) {
    const date = sorted[i].date;
    const mlCoverage = useArticleMlCoverage
      ? mlCoverageForSymbolWindow(symbol, date, 7)
      : 0;
    const features = extractFeaturesAt(
      sorted,
      sentimentTimeline,
      date,
      mlCoverage,
      benchmarkSeries,
      earningsEvents
    );
    if (!features) continue;
    const nextReturn = forwardReturn(sorted, date, forwardDays);
    if (nextReturn == null) continue;

    samples.push({ date, symbol, features, nextReturn });
  }

  return samples;
}

export async function collectWatchlistTrainingData(
  symbols: string[],
  historyDays = 500,
  forwardDays = 5
): Promise<TrainingSample[]> {
  await initArticleCoverageCache();
  const benchmarkCache = await loadBenchmarkSeries(historyDays);
  const earningsMap = await loadEarningsBySymbols(symbols);
  const all: TrainingSample[] = [];

  for (const symbol of symbols) {
    const entry = getSymbolEntry(symbol);
    if (!entry) continue;

    const [ohlcv, timeline] = await Promise.all([
      fetchOhlcv(entry.yfinanceTicker, historyDays),
      getSentimentTimeline(symbol, historyDays),
    ]);

    if (ohlcv.length < 40) continue;
    const earningsEvents = earningsMap.get(symbol.toUpperCase()) ?? [];
    all.push(
      ...buildSamplesFromSeries(
        symbol,
        ohlcv,
        timeline,
        60,
        true,
        forwardDays,
        benchmarkCache,
        earningsEvents
      )
    );
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}
