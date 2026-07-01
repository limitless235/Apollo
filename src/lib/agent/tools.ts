import { tool } from "ai";
import { z } from "zod";
import { resolveSymbol, getSymbolEntry } from "@/lib/symbols/registry";
import {
  fetchCompanyNews,
  upsertArticles,
  getArticlesForSymbol,
  getSentimentTimeline,
} from "@/lib/news/rss-fetcher";
import { fetchOhlcv, getPriceTrend } from "@/lib/prices/yfinance";
import { addToWatchlist } from "@/lib/watchlist";

export const agentTools = {
  resolveSymbol: tool({
    description: "Resolve a company name or ticker to an NSE symbol",
    inputSchema: z.object({
      query: z.string().describe("Company name or ticker, e.g. Infosys or INFY"),
    }),
    execute: async ({ query }) => {
      const entry = resolveSymbol(query);
      if (!entry) return { found: false, query };
      return {
        found: true,
        symbol: entry.symbol,
        companyName: entry.companyName,
        yfinanceTicker: entry.yfinanceTicker,
      };
    },
  }),

  fetchCompanyNews: tool({
    description: "Fetch and ingest latest news for an NSE symbol from Google News RSS",
    inputSchema: z.object({
      symbol: z.string().describe("NSE ticker symbol"),
      days: z.number().optional().default(7),
    }),
    execute: async ({ symbol, days }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const items = await fetchCompanyNews(entry.symbol);
      await upsertArticles(items);

      const articles = await getArticlesForSymbol(entry.symbol, days);
      return {
        symbol: entry.symbol,
        companyName: entry.companyName,
        articlesIngested: items.length,
        headlines: articles.slice(0, 10).map((a) => ({
          title: a.title,
          source: a.source,
          publishedAt: a.publishedAt.toISOString(),
          sentiment: a.sentimentScore,
          url: a.url,
        })),
      };
    },
  }),

  getNewsSentiment: tool({
    description: "Get sentiment timeline for a symbol over recent days",
    inputSchema: z.object({
      symbol: z.string(),
      days: z.number().optional().default(30),
    }),
    execute: async ({ symbol, days }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const timeline = await getSentimentTimeline(entry.symbol, days);
      const avg =
        timeline.length > 0
          ? timeline.reduce((s, t) => s + t.avgSentiment, 0) / timeline.length
          : 0;

      return {
        symbol: entry.symbol,
        averageSentiment: avg,
        timeline: timeline.slice(-14),
      };
    },
  }),

  getPriceContext: tool({
    description: "Get recent price trend for context when discussing news",
    inputSchema: z.object({
      symbol: z.string(),
      days: z.number().optional().default(30),
    }),
    execute: async ({ symbol, days }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const ohlcv = await fetchOhlcv(entry.yfinanceTicker, days);
      const trend = getPriceTrend(ohlcv);
      const latest = ohlcv[ohlcv.length - 1];

      return {
        symbol: entry.symbol,
        latestClose: latest?.close ?? null,
        changePercent: trend.changePercent,
        direction: trend.direction,
        periodDays: days,
      };
    },
  }),

  addToWatchlist: tool({
    description: "Add a symbol to the user's watchlist",
    inputSchema: z.object({
      symbol: z.string(),
    }),
    execute: async ({ symbol }) => {
      const entry = await addToWatchlist(symbol);
      return { added: true, symbol: entry.symbol, companyName: entry.companyName };
    },
  }),
};
