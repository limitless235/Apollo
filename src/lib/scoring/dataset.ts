import type { OhlcvBar } from "@/lib/prices/yfinance";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { extractFeaturesAt, type SentimentDay } from "./features";
import type { TrainingSample } from "./train-ridge";

function nextDayReturn(bars: OhlcvBar[], date: string): number | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0 || idx >= bars.length - 1) return null;
  const curr = bars[idx].close;
  const next = bars[idx + 1].close;
  if (curr <= 0) return null;
  return ((next - curr) / curr) * 100;
}

export function buildSamplesFromSeries(
  symbol: string,
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[] = [],
  minHistory = 30
): TrainingSample[] {
  const sorted = [...ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const samples: TrainingSample[] = [];

  for (let i = minHistory; i < sorted.length - 1; i++) {
    const date = sorted[i].date;
    const features = extractFeaturesAt(sorted, sentimentTimeline, date);
    if (!features) continue;
    const nextReturn = nextDayReturn(sorted, date);
    if (nextReturn == null) continue;

    samples.push({ date, symbol, features, nextReturn });
  }

  return samples;
}

export async function collectWatchlistTrainingData(
  symbols: string[],
  historyDays = 365
): Promise<TrainingSample[]> {
  const all: TrainingSample[] = [];

  for (const symbol of symbols) {
    const entry = getSymbolEntry(symbol);
    if (!entry) continue;

    const [ohlcv, timeline] = await Promise.all([
      fetchOhlcv(entry.yfinanceTicker, historyDays),
      getSentimentTimeline(symbol, historyDays),
    ]);

    if (ohlcv.length < 40) continue;
    all.push(...buildSamplesFromSeries(symbol, ohlcv, timeline));
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}
