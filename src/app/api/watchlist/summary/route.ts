import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getWatchlist } from "@/lib/watchlist";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { fetchOhlcv, fetchQuoteChange } from "@/lib/prices/yfinance";
import { getArticlesForSymbol, getSentimentTimeline } from "@/lib/news/rss-fetcher";

export async function GET() {
  initDb();
  const items = await getWatchlist();

  const cards = await Promise.all(
    items.map(async (item) => {
      const entry = getSymbolEntry(item.symbol);
      let changePercent = 0;
      let avgSentiment = 0;
      let newsCount = 0;

      if (entry) {
        const [change, articles, timeline] = await Promise.all([
          fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
          getArticlesForSymbol(item.symbol, 7).catch(() => []),
          getSentimentTimeline(item.symbol, 7).catch(() => []),
        ]);
        changePercent = change;
        newsCount = articles.length;
        avgSentiment =
          timeline.length > 0
            ? timeline.reduce((s, t) => s + t.avgSentiment, 0) / timeline.length
            : 0;
      }

      return {
        symbol: item.symbol,
        companyName: item.companyName,
        changePercent,
        avgSentiment,
        newsCount,
      };
    })
  );

  return NextResponse.json({ items: cards });
}
