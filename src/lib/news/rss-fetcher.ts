import Parser from "rss-parser";
import PQueue from "p-queue";
import { googleNewsFeedUrl } from "./feeds";
import { scoreSentiment } from "./sentiment";
import { tagSymbolsFromText } from "./symbol-tagger";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { initDb, getDb } from "@/lib/db";
import { articles, dailySentiment } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { MARKET_FEEDS } from "./feeds";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 });

export interface NormalizedArticle {
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: Date;
  symbols: string[];
  sentimentScore: number;
}

export async function fetchFeed(url: string): Promise<NormalizedArticle[]> {
  try {
    return (await queue.add(async () => {
      const feed = await parser.parseURL(url);
      const source = feed.title ?? new URL(url).hostname;

      return (feed.items ?? [])
        .filter((item) => item.title && item.link)
        .map((item) => {
          const title = item.title!.trim();
          const summary = (item.contentSnippet ?? item.content ?? "").trim();
          const text = `${title} ${summary}`;
          const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
          const explicitSymbols = tagSymbolsFromText(text);

          return {
            url: item.link!,
            title,
            summary: summary.slice(0, 500),
            source,
            publishedAt,
            symbols: explicitSymbols,
            sentimentScore: scoreSentiment(text),
          };
        });
    })) as NormalizedArticle[];
  } catch (error) {
    console.warn(`RSS fetch failed for ${url}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

export async function fetchCompanyNews(symbol: string): Promise<NormalizedArticle[]> {
  const entry = getSymbolEntry(symbol);
  if (!entry) return [];

  const url = googleNewsFeedUrl(entry.companyName);
  const items = await fetchFeed(url);
  return items.map((item) => ({
    ...item,
    symbols: Array.from(new Set([...item.symbols, entry.symbol])),
  }));
}

export async function upsertArticles(items: NormalizedArticle[]): Promise<number> {
  initDb();
  const db = getDb();
  let inserted = 0;
  const now = new Date();

  for (const item of items) {
    try {
      await db
        .insert(articles)
        .values({
          url: item.url,
          title: item.title,
          summary: item.summary,
          source: item.source,
          publishedAt: item.publishedAt,
          symbols: JSON.stringify(item.symbols),
          sentimentScore: item.sentimentScore,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: articles.url,
          set: {
            title: item.title,
            summary: item.summary,
            symbols: JSON.stringify(item.symbols),
            sentimentScore: item.sentimentScore,
            fetchedAt: now,
          },
        });
      inserted++;
    } catch {
      // skip malformed rows
    }
  }

  return inserted;
}

export async function recomputeDailySentiment(symbols: string[]): Promise<void> {
  initDb();
  const db = getDb();
  const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const allArticles = await db.select().from(articles);

  for (const symbol of uniqueSymbols) {
    const rows = allArticles.filter((row) => {
      const syms: string[] = JSON.parse(row.symbols);
      return syms.includes(symbol);
    });

    const byDate = new Map<
      string,
      { scores: number[]; bullish: number; bearish: number }
    >();

    for (const row of rows) {
      const date = row.publishedAt.toISOString().slice(0, 10);
      if (!byDate.has(date)) {
        byDate.set(date, { scores: [], bullish: 0, bearish: 0 });
      }
      const bucket = byDate.get(date)!;
      bucket.scores.push(row.sentimentScore);
      if (row.sentimentScore >= 0.2) bucket.bullish++;
      if (row.sentimentScore <= -0.2) bucket.bearish++;
    }

    for (const [date, bucket] of byDate) {
      const avg =
        bucket.scores.reduce((a, b) => a + b, 0) / Math.max(bucket.scores.length, 1);
      await db
        .insert(dailySentiment)
        .values({
          symbol,
          date,
          avgSentiment: avg,
          articleCount: bucket.scores.length,
          bullishCount: bucket.bullish,
          bearishCount: bucket.bearish,
        })
        .onConflictDoUpdate({
          target: [dailySentiment.symbol, dailySentiment.date],
          set: {
            avgSentiment: avg,
            articleCount: bucket.scores.length,
            bullishCount: bucket.bullish,
            bearishCount: bucket.bearish,
          },
        });
    }
  }
}

export async function ingestWatchlist(symbols: string[]): Promise<{
  articlesIngested: number;
  symbolsProcessed: number;
}> {
  initDb();
  let total = 0;

  for (const feed of MARKET_FEEDS) {
    const items = await fetchFeed(feed.url);
    total += await upsertArticles(items);
  }

  for (const symbol of symbols) {
    try {
      const items = await fetchCompanyNews(symbol);
      total += await upsertArticles(items);
    } catch (error) {
      console.warn(`Company news failed for ${symbol}:`, error);
    }
  }

  await recomputeDailySentiment(symbols);
  return { articlesIngested: total, symbolsProcessed: symbols.length };
}

export async function getArticlesForSymbol(
  symbol: string,
  days = 30
): Promise<
  Array<{
    id: number;
    url: string;
    title: string;
    summary: string | null;
    source: string | null;
    publishedAt: Date;
    sentimentScore: number;
  }>
> {
  initDb();
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select()
    .from(articles)
    .where(gte(articles.publishedAt, since))
    .orderBy(sql`${articles.publishedAt} DESC`);

  return rows
    .filter((row) => {
      const syms: string[] = JSON.parse(row.symbols);
      return syms.includes(symbol.toUpperCase());
    })
    .map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      summary: row.summary,
      source: row.source,
      publishedAt: row.publishedAt,
      sentimentScore: row.sentimentScore,
    }));
}

export async function getSentimentTimeline(symbol: string, days = 90) {
  initDb();
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(dailySentiment)
    .where(
      and(
        eq(dailySentiment.symbol, symbol.toUpperCase()),
        gte(dailySentiment.date, sinceStr)
      )
    )
    .orderBy(dailySentiment.date);

  return rows.map((r) => ({
    date: r.date,
    avgSentiment: r.avgSentiment,
    count: r.articleCount,
    bullishCount: r.bullishCount,
    bearishCount: r.bearishCount,
  }));
}
