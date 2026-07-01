const cache = new Map<string, { data: OhlcvBar[]; expires: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
}

function rangeForDays(days: number): string {
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  return "2y";
}

export async function fetchOhlcv(
  yfinanceTicker: string,
  days = 90
): Promise<OhlcvBar[]> {
  const cacheKey = `${yfinanceTicker}-${days}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    const range = rangeForDays(days);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfinanceTicker)}?interval=1d&range=${range}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 900 },
    });

    if (!res.ok) throw new Error(`Yahoo chart API ${res.status}`);

    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];

    if (!quote) return cached?.data ?? [];

    const data: OhlcvBar[] = timestamps
      .map((ts, i) => {
        const open = quote.open?.[i];
        const close = quote.close?.[i];
        if (open == null || close == null) return null;
        return {
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          open,
          high: quote.high?.[i] ?? open,
          low: quote.low?.[i] ?? open,
          close,
          volume: quote.volume?.[i] ?? 0,
        };
      })
      .filter((bar): bar is OhlcvBar => bar !== null);

    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL });
    return data;
  } catch (error) {
    console.error(`Yahoo chart error for ${yfinanceTicker}:`, error);
    return cached?.data ?? [];
  }
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result?: Array<{
      regularMarketChangePercent?: number;
      regularMarketPrice?: number;
    }>;
  };
}

export async function fetchQuoteChange(yfinanceTicker: string): Promise<number> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yfinanceTicker)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 900 },
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as YahooQuoteResponse;
    return json.quoteResponse?.result?.[0]?.regularMarketChangePercent ?? 0;
  } catch {
    return 0;
  }
}

export function getPriceTrend(ohlcv: OhlcvBar[]): {
  changePercent: number;
  direction: "up" | "down" | "flat";
} {
  if (ohlcv.length < 2) {
    return { changePercent: 0, direction: "flat" };
  }
  const first = ohlcv[0].close;
  const last = ohlcv[ohlcv.length - 1].close;
  const changePercent = ((last - first) / first) * 100;
  const direction =
    changePercent > 0.5 ? "up" : changePercent < -0.5 ? "down" : "flat";
  return { changePercent, direction };
}
