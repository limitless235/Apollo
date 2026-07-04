import type { OhlcvBar } from "@/lib/prices/yfinance";
import {
  benchmarkSnapshotAt,
  relativeDelta,
  type BenchmarkSnapshot,
} from "./benchmark-features";
import {
  computeEarningsFeatures,
  earningsFeatureValues,
} from "@/lib/earnings/features";
import type { EarningsEventRecord } from "@/lib/earnings/types";

export interface SentimentDay {
  date: string;
  avgSentiment: number;
  count: number;
}

export interface RawFeatures {
  momentum5d: number;
  momentum20d: number;
  return1d: number;
  volatility20d: number;
  volumeZScore: number;
  avgSentiment7d: number;
  sentimentDelta: number;
  newsCount7d: number;
  newsVolumeZ: number;
  sentimentMlCoverage: number;
  latestClose: number | null;
  /** % of latest close above (+) / below (-) its long-term moving average. 0 when history is too short. */
  trendStrength: number;
  /** Stock minus market (Nifty 50) — positive = outperforming the index. */
  momentum20dVsMarket: number;
  trendStrengthVsMarket: number;
  /** Stock minus sector index — positive = outperforming sector peers. */
  momentum20dVsSector: number;
  trendStrengthVsSector: number;
  volatility20dVsSector: number;
  /** Trading days since last earnings (0 if none in lookback). */
  daysSinceEarnings: number;
  /** 3d post-earnings return from last event (0 if unavailable). */
  postEarningsReturn3d: number;
  /** 1 if earnings event found in lookback window. */
  earningsDataAvailable: number;
  /** 1 if daysSinceEarnings <= 5. */
  hasRecentEarnings: number;
}

/** Minimum bars before we trust a long-term trend read. */
const MIN_TREND_BARS = 60;
/** Cap the long-term average window (trading days). */
const MAX_TREND_PERIOD = 200;

function movingAverage(bars: OhlcvBar[], period: number): number | null {
  if (bars.length < period || period <= 0) return null;
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.close, 0) / period;
}

/**
 * Long-term trend read: latest close vs its long-term SMA (up to 200 trading days).
 * Positive = trading above the long-term average (uptrend), negative = below (downtrend).
 * Returns 0 when there isn't enough history, so short-lived listings aren't penalized.
 */
function trendStrength(bars: OhlcvBar[]): number {
  if (bars.length < MIN_TREND_BARS) return 0;
  const period = Math.min(bars.length - 1, MAX_TREND_PERIOD);
  const sma = movingAverage(bars, period);
  if (sma == null || sma <= 0) return 0;
  const close = bars[bars.length - 1].close;
  return ((close - sma) / sma) * 100;
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

function return1d(bars: OhlcvBar[]): number {
  if (bars.length < 2) return 0;
  const prev = bars[bars.length - 2].close;
  const curr = bars[bars.length - 1].close;
  if (prev <= 0) return 0;
  return ((curr - prev) / prev) * 100;
}

export function extractFeatures(
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[] = [],
  sentimentMlCoverage = 0,
  benchmarks: { market?: BenchmarkSnapshot | null; sector?: BenchmarkSnapshot | null } = {},
  earningsEvents: EarningsEventRecord[] = [],
  asOfDate?: string
): RawFeatures {
  const recent7 = sentimentWindow(sentimentTimeline, 0, 7);
  const prior7 = sentimentWindow(sentimentTimeline, 7, 7);

  const mom20 = momentum(ohlcv, 20);
  const trend = trendStrength(ohlcv);
  const vol20 = volatility(ohlcv, 20);
  const featureDate = asOfDate ?? (ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].date : "");
  const earnings = computeEarningsFeatures(ohlcv, earningsEvents, featureDate);
  const ev = earningsFeatureValues(earnings);

  return {
    momentum5d: momentum(ohlcv, 5),
    momentum20d: mom20,
    return1d: return1d(ohlcv),
    volatility20d: vol20,
    volumeZScore: volumeZScore(ohlcv, 20),
    avgSentiment7d: recent7.avg,
    sentimentDelta: recent7.avg - prior7.avg,
    newsCount7d: recent7.count,
    newsVolumeZ: newsVolumeZ(sentimentTimeline),
    sentimentMlCoverage,
    latestClose: ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : null,
    trendStrength: trend,
    momentum20dVsMarket: relativeDelta(mom20, benchmarks.market?.momentum20d),
    trendStrengthVsMarket: relativeDelta(trend, benchmarks.market?.trendStrength),
    momentum20dVsSector: relativeDelta(mom20, benchmarks.sector?.momentum20d),
    trendStrengthVsSector: relativeDelta(trend, benchmarks.sector?.trendStrength),
    volatility20dVsSector: relativeDelta(vol20, benchmarks.sector?.volatility20d),
    daysSinceEarnings: ev.daysSinceEarnings,
    postEarningsReturn3d: ev.postEarningsReturn3d,
    earningsDataAvailable: ev.earningsDataAvailable,
    hasRecentEarnings: ev.hasRecentEarnings,
  };
}

/** Point-in-time features for backtesting (no look-ahead). */
export function extractFeaturesAt(
  ohlcv: OhlcvBar[],
  sentimentTimeline: SentimentDay[],
  asOfDate: string,
  sentimentMlCoverage = 0,
  benchmarkSeries: {
    market?: OhlcvBar[];
    sector?: OhlcvBar[] | null;
  } = {},
  earningsEvents: EarningsEventRecord[] = []
): RawFeatures | null {
  const bars = ohlcv.filter((b) => b.date <= asOfDate);
  if (bars.length < 22) return null;

  const sentiment = sentimentTimeline.filter((d) => d.date <= asOfDate);
  const market = benchmarkSeries.market
    ? benchmarkSnapshotAt(benchmarkSeries.market, asOfDate)
    : null;
  const sector = benchmarkSeries.sector
    ? benchmarkSnapshotAt(benchmarkSeries.sector, asOfDate)
    : null;

  return extractFeatures(bars, sentiment, sentimentMlCoverage, { market, sector }, earningsEvents, asOfDate);
}
