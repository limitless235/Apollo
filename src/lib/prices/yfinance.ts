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
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        symbol?: string;
      };
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
  if (days <= 730) return "2y";
  if (days <= 1825) return "5y";
  return "max";
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

    const trimmed = days > 0 && data.length > days ? data.slice(-days) : data;

    cache.set(cacheKey, { data: trimmed, expires: Date.now() + CACHE_TTL });
    return trimmed;
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
      regularMarketChange?: number;
    }>;
  };
}

export async function fetchQuoteChange(yfinanceTicker: string): Promise<number> {
  const quote = await fetchMarketQuote(yfinanceTicker);
  return quote?.changePercent ?? 0;
}

export async function fetchMarketQuote(
  yfinanceTicker: string
): Promise<{ price: number; changePercent: number; previousClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfinanceTicker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    const quote = result?.indicators?.quote?.[0];
    const closes = quote?.close?.filter((c): c is number => c != null) ?? [];

    let price = meta?.regularMarketPrice ?? closes[closes.length - 1];
    const previousClose =
      meta?.chartPreviousClose ?? meta?.previousClose ?? closes[closes.length - 2];

    if (price == null) return null;

    const changePercent =
      previousClose != null && previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;

    return {
      price,
      changePercent,
      previousClose: previousClose ?? price,
    };
  } catch {
    return null;
  }
}

/** @deprecated v7 quote endpoint — kept as fallback only */
async function fetchMarketQuoteV7(
  yfinanceTicker: string
): Promise<{ price: number; changePercent: number; previousClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yfinanceTicker)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooQuoteResponse;
    const row = json.quoteResponse?.result?.[0];
    if (row?.regularMarketPrice == null) return null;
    const previousClose =
      row.regularMarketPrice - (row.regularMarketChange ?? 0);
    return {
      price: row.regularMarketPrice,
      changePercent: row.regularMarketChangePercent ?? 0,
      previousClose,
    };
  } catch {
    return null;
  }
}

export async function fetchMarketQuoteReliable(
  yfinanceTicker: string
): Promise<{ price: number; changePercent: number; previousClose: number } | null> {
  return (await fetchMarketQuote(yfinanceTicker)) ?? (await fetchMarketQuoteV7(yfinanceTicker));
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

export interface YahooSearchResult {
  symbol: string;
  companyName: string;
  yfinanceTicker: string;
  exchange: "NSE" | "BSE";
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
  }>;
}

function parseIndianQuote(
  quote: NonNullable<YahooSearchResponse["quotes"]>[number]
): YahooSearchResult | null {
  if (!quote.symbol) return null;
  if (quote.quoteType && !["EQUITY", "ETF"].includes(quote.quoteType)) return null;

  let exchange: "NSE" | "BSE" | null = null;
  if (quote.symbol.endsWith(".NS")) exchange = "NSE";
  else if (quote.symbol.endsWith(".BO")) exchange = "BSE";
  if (!exchange) return null;

  const symbol = quote.symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
  return {
    symbol,
    companyName: quote.longname ?? quote.shortname ?? symbol,
    yfinanceTicker: quote.symbol,
    exchange,
  };
}

/** Search Yahoo Finance for NSE- and BSE-listed equities/ETFs. */
export async function searchYahooIndianSymbols(
  query: string,
  limit = 10,
  exchanges: Array<"NSE" | "BSE"> = ["NSE", "BSE"]
): Promise<YahooSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${Math.max(limit * 2, 12)}&newsCount=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as YahooSearchResponse;
    const results: YahooSearchResult[] = [];
    const seen = new Set<string>();

    for (const quote of json.quotes ?? []) {
      const parsed = parseIndianQuote(quote);
      if (!parsed || !exchanges.includes(parsed.exchange)) continue;

      const key = `${parsed.symbol}:${parsed.exchange}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push(parsed);
      if (results.length >= limit) break;
    }

    return results;
  } catch (error) {
    console.error("Yahoo search error:", error);
    return [];
  }
}

/** @deprecated use searchYahooIndianSymbols */
export async function searchYahooNseSymbols(
  query: string,
  limit = 10
): Promise<YahooSearchResult[]> {
  return searchYahooIndianSymbols(query, limit, ["NSE"]);
}

export interface YahooMutualFundResult {
  symbol: string;
  schemeName: string;
  yfinanceTicker: string;
}

/** Search Yahoo Finance for Indian mutual fund schemes (BSE-listed NAV on Yahoo). */
export async function searchYahooMutualFunds(
  query: string,
  limit = 12
): Promise<YahooMutualFundResult[]> {
  const q = query.trim();
  if (!q) return [];

  async function runSearch(searchTerm: string): Promise<YahooMutualFundResult[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchTerm)}&quotesCount=${Math.max(limit * 2, 16)}&newsCount=0`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 },
      });
      if (!res.ok) return [];

      const json = (await res.json()) as YahooSearchResponse;
      const results: YahooMutualFundResult[] = [];
      const seen = new Set<string>();

      for (const quote of json.quotes ?? []) {
        if (quote.quoteType !== "MUTUALFUND" || !quote.symbol) continue;
        if (!quote.symbol.endsWith(".BO") && !quote.symbol.endsWith(".NS")) continue;

        const yfinanceTicker = quote.symbol;
        const symbol = yfinanceTicker.replace(/\.(BO|NS)$/i, "").toUpperCase();
        if (seen.has(yfinanceTicker)) continue;
        seen.add(yfinanceTicker);

        results.push({
          symbol,
          schemeName: quote.longname ?? quote.shortname ?? symbol,
          yfinanceTicker,
        });
        if (results.length >= limit) break;
      }
      return results;
    } catch (error) {
      console.error("Yahoo MF search error:", error);
      return [];
    }
  }

  let results = await runSearch(q);
  if (results.length === 0 && !q.toLowerCase().includes("mutual")) {
    results = await runSearch(`${q} mutual fund`);
  }
  return results;
}
