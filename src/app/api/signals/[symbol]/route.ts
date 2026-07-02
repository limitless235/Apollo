import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getWatchlist } from "@/lib/watchlist";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { computeWatchlistSignals, backtestSymbol } from "@/lib/scoring";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  initDb();
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();
  const entry = getSymbolEntry(symbol);

  if (!entry) {
    return NextResponse.json({ error: `Unknown symbol: ${symbol}` }, { status: 404 });
  }

  const watchlist = await getWatchlist();
  const batchItems = watchlist.some((w) => w.symbol === symbol)
    ? watchlist
    : [...watchlist, { symbol, companyName: entry.companyName }];

  const [signals, backtestOhlcv, timeline] = await Promise.all([
    computeWatchlistSignals(batchItems),
    fetchOhlcv(entry.yfinanceTicker, 365),
    getSentimentTimeline(symbol, 60),
  ]);

  const signal = signals.find((s) => s.symbol === symbol);
  if (!signal) {
    return NextResponse.json({ error: `Could not score: ${symbol}` }, { status: 500 });
  }

  const backtest = backtestSymbol(symbol, backtestOhlcv, timeline);

  return NextResponse.json({
    ...signal,
    backtest: {
      days: backtest.days,
      ic: backtest.ic,
      directionalAccuracy: backtest.directionalAccuracy,
      hitRateHighScore: backtest.hitRateHighScore,
      avgNextReturnWhenBullish: backtest.avgNextReturnWhenBullish,
      avgNextReturnWhenBearish: backtest.avgNextReturnWhenBearish,
    },
  });
}
