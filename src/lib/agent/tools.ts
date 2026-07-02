import { tool } from "ai";
import { z } from "zod";
import { resolveSymbol, getSymbolEntry } from "@/lib/symbols/registry";
import {
  fetchCompanyNews,
  upsertArticles,
  getArticlesForSymbol,
  getSentimentTimeline,
} from "@/lib/news/rss-fetcher";
import { fetchOhlcv, fetchQuoteChange, getPriceTrend } from "@/lib/prices/yfinance";
import { addToWatchlist, getWatchlist } from "@/lib/watchlist";
import { computeWatchlistSignals, extractFeatures, rankSignals } from "@/lib/scoring";

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
          sentimentSource: a.sentimentSource,
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

  getWatchlistSignals: tool({
    description:
      "Rank watchlist symbols by composite signal score (momentum, sentiment, news activity, volume)",
    inputSchema: z.object({
      limit: z.number().optional().default(10),
    }),
    execute: async ({ limit }) => {
      const watchlist = await getWatchlist();
      const signals = await computeWatchlistSignals(watchlist);
      return {
        updatedAt: new Date().toISOString(),
        items: signals.slice(0, limit).map((s) => ({
          rank: s.rank,
          symbol: s.symbol,
          companyName: s.companyName,
          score: s.score,
          label: s.label,
          flags: s.flags,
          momentum5d: s.features.momentum5d,
          momentum20d: s.features.momentum20d,
          avgSentiment7d: s.features.avgSentiment7d,
          newsCount7d: s.features.newsCount7d,
        })),
      };
    },
  }),

  getSymbolSignal: tool({
    description: "Get detailed signal breakdown for a single NSE symbol",
    inputSchema: z.object({
      symbol: z.string(),
    }),
    execute: async ({ symbol }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const [ohlcv, timeline, changePercent] = await Promise.all([
        fetchOhlcv(entry.yfinanceTicker, 90),
        getSentimentTimeline(entry.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
      ]);

      const features = extractFeatures(ohlcv, timeline);
      const [signal] = rankSignals([
        {
          symbol: entry.symbol,
          companyName: entry.companyName,
          features,
          changePercent,
        },
      ]);

      return {
        symbol: signal.symbol,
        score: signal.score,
        label: signal.label,
        flags: signal.flags,
        breakdown: signal.breakdown.map((b) => ({
          factor: b.label,
          raw: b.raw,
          contribution: b.contribution,
        })),
        features: signal.features,
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
