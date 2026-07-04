export type EarningsSource = "nse_announcement" | "screener_in" | "manual" | "yfinance_fallback";

export interface EarningsEventRecord {
  symbol: string;
  eventDate: string;
  actualEps: number | null;
  estimateEps: number | null;
  source: EarningsSource;
}

export interface EarningsFeatures {
  daysSinceEarnings: number | null;
  postEarningsReturn3d: number | null;
  hasRecentEarnings: boolean;
  earningsDataAvailable: boolean;
}

export const EARNINGS_LOOKBACK_DAYS = 120;
export const NEAR_EARNINGS_DAYS = 5;
export const POST_EARNINGS_RETURN_DAYS = 3;
