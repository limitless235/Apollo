import { fetchOhlcv, type OhlcvBar } from "./yfinance";
import {
  getMarketIndexTicker,
  getSectorYahooTicker,
  getAllSectorIds,
} from "@/lib/scoring/sector-mapping";

const cache = new Map<string, { data: OhlcvBar[]; expires: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export async function fetchBenchmarkOhlcv(
  yahooTicker: string,
  days = 500
): Promise<OhlcvBar[]> {
  const cacheKey = `${yahooTicker}-${days}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const data = await fetchOhlcv(yahooTicker, days);
  cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

export async function loadMarketBenchmark(days = 500): Promise<OhlcvBar[]> {
  return fetchBenchmarkOhlcv(getMarketIndexTicker(), days);
}

export async function loadSectorBenchmarks(
  days = 500
): Promise<Map<string, OhlcvBar[]>> {
  const map = new Map<string, OhlcvBar[]>();
  const ids = getAllSectorIds();

  await Promise.all(
    ids.map(async (id) => {
      const ticker = getSectorYahooTicker(id);
      if (!ticker) return;
      const bars = await fetchBenchmarkOhlcv(ticker, days);
      if (bars.length > 0) map.set(id, bars);
    })
  );

  return map;
}
