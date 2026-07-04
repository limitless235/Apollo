import type { OhlcvBar } from "@/lib/prices/yfinance";

/** Benchmark metrics at a single as-of date for relative feature computation. */
export interface BenchmarkSnapshot {
  momentum20d: number;
  trendStrength: number;
  volatility20d: number;
}

function barsUpTo(ohlcv: OhlcvBar[], asOfDate: string): OhlcvBar[] {
  return ohlcv.filter((b) => b.date <= asOfDate);
}

function momentum(bars: OhlcvBar[], days: number): number {
  if (bars.length <= days) return 0;
  const start = bars[bars.length - days - 1].close;
  const end = bars[bars.length - 1].close;
  if (start <= 0) return 0;
  return ((end - start) / start) * 100;
}

function trendStrength(bars: OhlcvBar[]): number {
  const MIN = 60;
  const MAX = 200;
  if (bars.length < MIN) return 0;
  const period = Math.min(bars.length - 1, MAX);
  const slice = bars.slice(-period);
  const sma = slice.reduce((s, b) => s + b.close, 0) / period;
  if (sma <= 0) return 0;
  return ((bars[bars.length - 1].close - sma) / sma) * 100;
}

function volatility(bars: OhlcvBar[], days: number): number {
  if (bars.length < days + 1) return 0;
  const returns: number[] = [];
  const window = bars.slice(-days - 1);
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1].close;
    const curr = window[i].close;
    if (prev > 0) returns.push(Math.log(curr / prev));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function benchmarkSnapshotAt(
  ohlcv: OhlcvBar[],
  asOfDate: string
): BenchmarkSnapshot | null {
  const bars = barsUpTo(ohlcv, asOfDate);
  if (bars.length < 22) return null;
  return {
    momentum20d: momentum(bars, 20),
    trendStrength: trendStrength(bars),
    volatility20d: volatility(bars, 20),
  };
}

export function relativeDelta(stock: number, benchmark: number | undefined): number {
  if (benchmark == null) return 0;
  return stock - benchmark;
}
