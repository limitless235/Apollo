import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getArticlesForSymbol, getSentimentTimeline } from "@/lib/news/rss-fetcher";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv } from "@/lib/prices/yfinance";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  initDb();
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get("days") ?? 730), 30), 3650);

  const entry = getSymbolEntry(symbol);
  if (!entry) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 404 });
  }

  const [ohlcv, newsArticles, sentimentTimeline] = await Promise.all([
    fetchOhlcv(entry.yfinanceTicker, days),
    getArticlesForSymbol(symbol, days),
    getSentimentTimeline(symbol, days),
  ]);

  const newsMarkers = newsArticles.map((a) => ({
    date: a.publishedAt.toISOString().slice(0, 10),
    title: a.title,
    sentiment: a.sentimentScore,
    url: a.url,
    id: a.id,
  }));

  return NextResponse.json({
    symbol,
    companyName: entry.companyName,
    ohlcv,
    newsMarkers,
    sentimentTimeline,
  });
}
