import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv, fetchQuoteChange } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { extractFeatures, rankSignals, backtestSymbol } from "@/lib/scoring";

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

  const [ohlcv, timeline, changePercent, backtestOhlcv] = await Promise.all([
    fetchOhlcv(entry.yfinanceTicker, 90),
    getSentimentTimeline(symbol, 60),
    fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
    fetchOhlcv(entry.yfinanceTicker, 365),
  ]);

  const features = extractFeatures(ohlcv, timeline);
  const [signal] = rankSignals([
    { symbol, companyName: entry.companyName, features, changePercent },
  ]);

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
