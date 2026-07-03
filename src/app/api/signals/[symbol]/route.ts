import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getWatchlist } from "@/lib/watchlist";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import {
  computeWatchlistSignals,
  backtestSymbol,
  generateTradeRecommendation,
} from "@/lib/scoring";

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

  const chartChange90d =
    backtestOhlcv.length >= 2
      ? ((backtestOhlcv[backtestOhlcv.length - 1].close - backtestOhlcv[0].close) /
          backtestOhlcv[0].close) *
        100
      : undefined;

  const recommendation = generateTradeRecommendation({
    symbol: signal.symbol,
    companyName: signal.companyName,
    score: signal.score,
    heuristicScore: signal.heuristicScore,
    learnedScore: signal.learnedScore,
    label: signal.label,
    rank: signal.rank,
    watchlistSize: batchItems.length,
    momentum5d: signal.features.momentum5d,
    momentum20d: signal.features.momentum20d,
    avgSentiment7d: signal.features.avgSentiment7d,
    sentimentDelta: signal.features.sentimentDelta,
    newsCount7d: signal.features.newsCount7d,
    volatility20d: signal.features.volatility20d,
    volumeZScore: signal.features.volumeZScore,
    changePercent: signal.changePercent,
    backtestIc: backtest.ic,
    backtestDa: backtest.directionalAccuracy,
    backtestDays: backtest.days,
    chartChange90d,
  });

  return NextResponse.json({
    ...signal,
    recommendation,
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
