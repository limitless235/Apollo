import type { OhlcvBar } from "@/lib/prices/yfinance";
import type { EarningsEventRecord, EarningsFeatures } from "./types";
import {
  EARNINGS_LOOKBACK_DAYS,
  NEAR_EARNINGS_DAYS,
  POST_EARNINGS_RETURN_DAYS,
} from "./types";

function barIndexOnOrBefore(bars: OhlcvBar[], date: string): number {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date <= date) return i;
  }
  return -1;
}

/** Post-earnings return over N trading days from event date (PIT-safe once days elapsed). */
export function postEarningsReturnNd(
  bars: OhlcvBar[],
  eventDate: string,
  days = POST_EARNINGS_RETURN_DAYS
): number | null {
  const startIdx = barIndexOnOrBefore(bars, eventDate);
  if (startIdx < 0 || startIdx + days >= bars.length) return null;

  const start = bars[startIdx].close;
  const end = bars[startIdx + days].close;
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

/**
 * Point-in-time earnings features — only uses events with eventDate <= asOfDate.
 */
export function computeEarningsFeatures(
  ohlcv: OhlcvBar[],
  events: EarningsEventRecord[],
  asOfDate: string,
  lookbackDays = EARNINGS_LOOKBACK_DAYS
): EarningsFeatures {
  const bars = ohlcv.filter((b) => b.date <= asOfDate);
  if (bars.length === 0) {
    return {
      daysSinceEarnings: null,
      postEarningsReturn3d: null,
      hasRecentEarnings: false,
      earningsDataAvailable: false,
    };
  }

  const lookbackStart = bars[Math.max(0, bars.length - lookbackDays)].date;
  const pastEvents = events
    .filter((e) => e.eventDate <= asOfDate && e.eventDate >= lookbackStart)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  if (pastEvents.length === 0) {
    return {
      daysSinceEarnings: null,
      postEarningsReturn3d: null,
      hasRecentEarnings: false,
      earningsDataAvailable: false,
    };
  }

  const lastEvent = pastEvents[pastEvents.length - 1];
  const eventBarIdx = barIndexOnOrBefore(bars, lastEvent.eventDate);
  if (eventBarIdx < 0) {
    return {
      daysSinceEarnings: null,
      postEarningsReturn3d: null,
      hasRecentEarnings: false,
      earningsDataAvailable: false,
    };
  }

  const asOfIdx = bars.length - 1;
  const daysSinceEarnings = asOfIdx - eventBarIdx;

  const postReturn =
    asOfIdx >= eventBarIdx + POST_EARNINGS_RETURN_DAYS
      ? postEarningsReturnNd(bars, lastEvent.eventDate, POST_EARNINGS_RETURN_DAYS)
      : null;

  return {
    daysSinceEarnings,
    postEarningsReturn3d: postReturn,
    hasRecentEarnings: daysSinceEarnings <= NEAR_EARNINGS_DAYS,
    earningsDataAvailable: true,
  };
}

/** Merge earnings features into model-facing numeric fields on RawFeatures. */
export function earningsFeatureValues(f: EarningsFeatures): {
  daysSinceEarnings: number;
  postEarningsReturn3d: number;
  earningsDataAvailable: number;
  hasRecentEarnings: number;
} {
  return {
    daysSinceEarnings: f.daysSinceEarnings ?? 0,
    postEarningsReturn3d: f.postEarningsReturn3d ?? 0,
    earningsDataAvailable: f.earningsDataAvailable ? 1 : 0,
    hasRecentEarnings: f.hasRecentEarnings ? 1 : 0,
  };
}
