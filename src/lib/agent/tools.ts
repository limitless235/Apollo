import { tool } from "ai";
import { z } from "zod";
import { resolveSymbol, getSymbolEntry } from "@/lib/symbols/registry";
import {
  fetchCompanyNews,
  upsertArticles,
  getArticlesForSymbol,
  getSentimentTimeline,
  recomputeDailySentiment,
} from "@/lib/news/rss-fetcher";
import { isFinbertAvailable, getSentimentModelLabel, FINBERT_MODEL } from "@/lib/news/sentiment";
import { fetchOhlcv, fetchQuoteChange, getPriceTrend } from "@/lib/prices/yfinance";
import { addToWatchlist, getWatchlist } from "@/lib/watchlist";
import { getPortfolioHoldings, analyzePortfolio } from "@/lib/portfolio";
import { computeWatchlistSignals, getRankerStatus, generateTradeRecommendation, backtestSymbol } from "@/lib/scoring";

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
      await recomputeDailySentiment([entry.symbol]);

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
    description: "Get detailed signal breakdown for a single NSE symbol (uses full watchlist batch for ML)",
    inputSchema: z.object({
      symbol: z.string(),
    }),
    execute: async ({ symbol }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const watchlist = await getWatchlist();
      const batchItems = watchlist.some((w) => w.symbol === entry.symbol)
        ? watchlist
        : [...watchlist, { symbol: entry.symbol, companyName: entry.companyName }];

      const [signals, backtestOhlcv, timeline, changePercent] = await Promise.all([
        computeWatchlistSignals(batchItems),
        fetchOhlcv(entry.yfinanceTicker, 365),
        getSentimentTimeline(entry.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
      ]);

      const signal = signals.find((s) => s.symbol === entry.symbol);
      if (!signal) return { error: `Could not score ${entry.symbol}` };

      const backtest = backtestSymbol(entry.symbol, backtestOhlcv, timeline);
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
        changePercent,
        backtestIc: backtest.ic,
        backtestDa: backtest.directionalAccuracy,
        backtestDays: backtest.days,
        chartChange90d,
        recentEarningsReaction: signal.flags.includes("Recent earnings reaction"),
        postEarningsReturn3d: signal.features.postEarningsReturn3d,
      });

      return {
        symbol: signal.symbol,
        rank: signal.rank,
        score: signal.score,
        heuristicScore: signal.heuristicScore,
        learnedScore: signal.learnedScore,
        rankerActive: signal.rankerActive,
        label: signal.label,
        flags: signal.flags,
        recommendation,
        backtest: {
          ic: backtest.ic,
          directionalAccuracy: backtest.directionalAccuracy,
          days: backtest.days,
        },
        breakdown: signal.breakdown.map((b) => ({
          factor: b.label,
          raw: b.raw,
          contribution: b.contribution,
        })),
        features: signal.features,
      };
    },
  }),

  getTradeRecommendation: tool({
    description:
      "Personal BUY/HOLD/SELL/AVOID opinion for a symbol based on Apollo signals, momentum, sentiment, and backtest",
    inputSchema: z.object({
      symbol: z.string(),
    }),
    execute: async ({ symbol }) => {
      const entry = getSymbolEntry(symbol);
      if (!entry) return { error: `Unknown symbol: ${symbol}` };

      const watchlist = await getWatchlist();
      const batchItems = watchlist.some((w) => w.symbol === entry.symbol)
        ? watchlist
        : [...watchlist, { symbol: entry.symbol, companyName: entry.companyName }];

      const [signals, backtestOhlcv, timeline, changePercent] = await Promise.all([
        computeWatchlistSignals(batchItems),
        fetchOhlcv(entry.yfinanceTicker, 365),
        getSentimentTimeline(entry.symbol, 60),
        fetchQuoteChange(entry.yfinanceTicker).catch(() => 0),
      ]);

      const signal = signals.find((s) => s.symbol === entry.symbol);
      if (!signal) return { error: `Could not score ${entry.symbol}` };

      const backtest = backtestSymbol(entry.symbol, backtestOhlcv, timeline);
      const chartChange90d =
        backtestOhlcv.length >= 2
          ? ((backtestOhlcv[backtestOhlcv.length - 1].close - backtestOhlcv[0].close) /
              backtestOhlcv[0].close) *
            100
          : undefined;

      return generateTradeRecommendation({
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
        changePercent,
        backtestIc: backtest.ic,
        backtestDa: backtest.directionalAccuracy,
        backtestDays: backtest.days,
        chartChange90d,
        recentEarningsReaction: signal.flags.includes("Recent earnings reaction"),
        postEarningsReturn3d: signal.features.postEarningsReturn3d,
      });
    },
  }),

  getSentimentStatus: tool({
    description: "Check FinBERT/hybrid sentiment model status and article coverage",
    inputSchema: z.object({}),
    execute: async () => {
      const finbertReady = await isFinbertAvailable();
      const mode = process.env.SENTIMENT_MODEL ?? "hybrid";
      return {
        model: FINBERT_MODEL,
        mode,
        finbertReady,
        label: getSentimentModelLabel(
          mode === "rules" ? "rules" : mode === "finbert" ? "finbert" : "hybrid"
        ),
        hint: finbertReady
          ? "Headlines are scored with FinBERT + keyword hybrid by default."
          : "FinBERT unavailable; falling back to keyword rules only.",
      };
    },
  }),

  getRankerStatus: tool({
    description: "Check ML ranker model status (walk-forward ridge regression on features)",
    inputSchema: z.object({}),
    execute: async () => getRankerStatus(),
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

  getPortfolio: tool({
    description: "List the user's portfolio holdings (stocks, ETFs, mutual funds) with quantities and cost basis",
    inputSchema: z.object({}),
    execute: async () => {
      const items = await getPortfolioHoldings();
      return {
        count: items.length,
        holdings: items.map((h) => ({
          id: h.id,
          symbol: h.symbol,
          name: h.name,
          assetType: h.assetType,
          quantity: h.quantity,
          avgCost: h.avgCost,
          notes: h.notes,
        })),
      };
    },
  }),

  analyzePortfolio: tool({
    description:
      "Full portfolio analysis: current value, P&L, allocation, weights, Apollo signals and BUY/HOLD/SELL per holding",
    inputSchema: z.object({}),
    execute: async () => {
      const analysis = await analyzePortfolio();
      return {
        ...analysis,
        holdings: analysis.holdings.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          assetType: h.assetType,
          quantity: h.quantity,
          avgCost: h.avgCost,
          currentPrice: h.currentPrice,
          investedValue: h.investedValue,
          currentValue: h.currentValue,
          pnl: h.pnl,
          pnlPercent: h.pnlPercent,
          weight: h.weight,
          score: h.score,
          rank: h.rank,
          label: h.label,
          recommendation: h.recommendation,
        })),
      };
    },
  }),
};
