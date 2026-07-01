import type { OhlcvBar } from "@/lib/prices/yfinance";

export interface SentimentDay {
  date: string;
  avgSentiment: number;
  count: number;
}

export interface RawFeatures {
  momentum5d: number;
  momentum20d: number;
  volatility20d: number;
  volumeZScore: number;
  avgSentiment7d: number;
  sentimentDelta: number;
  newsCount7d: number;
  newsVolumeZ: number;
  latestClose: number | null;
}

function dailyLogReturns(bars: OhlcvBar[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (prev > 0) returns.push(Math.log(curr / prev));
  }
  return returns;
}

function momentum(bars: OhlcvBar[], days: number): number {
  if (bars.length <= days) return 0;
  const start = bars[bars.length - days - 1].close;
  const end = bars[bars.length - 1].close;
  if (start <= 0) return 0;
  return ((end - start) / start) * 100;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function volatility(bars: OhlcvBar[], days: number): number {
  const returns = dailyLogReturns(bars);
  const window = returns.slice(-days);
  if (window.length < 2) return 0;
  return stdDev(window) * Math.sqrt(252) * 100;
}

function volumeZScore(bars: OhlcvBar[], lookback = 20): number {
  if (bars.length < lookback + 1) return 0;
  const volumes = bars.slice(-lookback - 1, -1).map((b) => b.volume);
  const latest = bars[bars.length - 1].volume;
  const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const sd = stdDev(volumes);
  if (sd === 0) return 0;
  return (latest - mean) / sd;
}

function sentimentWindow(
  timeline: SentimentDay[],
  endOffsetDays: number,
  windowDays: number
): { avg: number; count: number } {
  if (timeline.length === 0) return { avg: 0, count: 0 };

  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));
  const endIdx = sorted.length - 1 - endOffsetDays;
  if (endIdx < 0) return { avg: 0, count: 0 };

  const startIdx = Math.max(0, endIdx - windowDays + 1);
  const slice = sorted.slice(startIdx, endIdx + 1);
  if (slice.length === 0) return { avg: 0, count: 0 };

  const totalArticles = slice.reduce((s, d) => s + d.count, 0);
  const weighted =
    slice.reduce((s, d) => s + d.avgSentiment * Math.max(d.count, 1), 0) /
    slice.reduce((s, d) => s + Math.max(d.count, 1), 0);

  return { avg: weighted, count: totalArticles };
}

function newsVolumeZ(timeline: SentimentDay[], recentDays = 7, baselineDays = 30): number {
  if (timeline.length === 0) return 0;

  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-recentDays);
  const baseline = sorted.slice(-baselineDays);

  const recentCount = recent.reduce((s, d) => s + d.count, 0);
  const dailyCounts = baseline.map((d) => d.count);
  if (dailyCounts.length === 0) return 0;

  const mean = dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length;
  const sd = stdDev(dailyCounts);
  const recentDaily = recentCount / Math.max(recent.length, 1);

  if (sd === 0) return recentDaily > mean ? 1 : 0;
  return (recentDaily - mean) / sd;
}

export function extractFeatures(
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[] = []
): RawFeatures {
  const recent7 = sentimentWindow(sentimentTimeline, 0, 7);
  const prior7 = sentimentWindow(sentimentTimeline, 7, 7);

  return {
    momentum5d: momentum(ohlcv, 5),
    momentum20d: momentum(ohlcv, 20),
    volatility20d: volatility(ohlcv, 20),
    volumeZScore: volumeZScore(ohlcv, 20),
    avgSentiment7d: recent7.avg,
    sentimentDelta: recent7.avg - prior7.avg,
    newsCount7d: recent7.count,
    newsVolumeZ: newsVolumeZ(sentimentTimeline),
    latestClose: ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : null,
  };
}

/** Point-in-time features for backtesting (no look-ahead). */
export function extractFeaturesAt(
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[],
  asOfDate: string
): RawFeatures | null {
  const bars = ohlcv.filter((b) => b.date <= asOfDate);
  if (bars.length < 22) return null;

  const sentiment = sentimentTimeline.filter((d) => d.date <= asOfDate);
  return extractFeatures(bars, sentiment);
}
