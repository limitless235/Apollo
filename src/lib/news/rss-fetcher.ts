import Parser from "rss-parser";
import PQueue from "p-queue";
import { googleNewsFeedUrl } from "./feeds";
import { analyzeSentimentBatch, type SentimentSource } from "./sentiment";
import { tagSymbolsFromText } from "./symbol-tagger";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { initDb, getDb } from "@/lib/db";
import { articles, dailySentiment } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { MARKET_FEEDS } from "./feeds";
import type { NewsIngestTarget } from "./ingest-targets";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

const queue = new PQueue({ concurrency: 2, interval: 800, intervalCap: 2 });

export interface NormalizedArticle {
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: Date;
  symbols: string[];
  sentimentScore: number;
  sentimentSource: SentimentSource;
}

export async function fetchFeed(url: string): Promise<NormalizedArticle[]> {
  try {
    return (await queue.add(async () => {
      const feed = await parser.parseURL(url);
      const source = feed.title ?? new URL(url).hostname;

      const rawItems = (feed.items ?? [])
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
            text,
          };
        });

      const sentiments = await analyzeSentimentBatch(rawItems.map((item) => item.text));

      return rawItems.map((item, i) => ({
        url: item.url,
        title: item.title,
        summary: item.summary,
        source: item.source,
        publishedAt: item.publishedAt,
        symbols: item.symbols,
        sentimentScore: sentiments[i].score,
        sentimentSource: sentiments[i].source,
      }));
    })) as NormalizedArticle[];
  } catch (error) {
    console.warn(`RSS fetch failed for ${url}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

export async function fetchCompanyNews(
  symbol: string,
  companyNameOverride?: string
): Promise<NormalizedArticle[]> {
  const entry = getSymbolEntry(symbol);
  const companyName = companyNameOverride ?? entry?.companyName;
  if (!companyName) return [];

  const url = googleNewsFeedUrl(companyName, symbol);
  const items = await fetchFeed(url);
  return items.map((item) => ({
    ...item,
    symbols: Array.from(new Set([...item.symbols, symbol.toUpperCase()])),
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
          sentimentSource: item.sentimentSource,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: articles.url,
          set: {
            title: item.title,
            summary: item.summary,
            symbols: JSON.stringify(item.symbols),
            sentimentScore: item.sentimentScore,
            sentimentSource: item.sentimentSource,
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

export async function ingestWatchlist(
  targets: NewsIngestTarget[] | string[]
): Promise<{
  articlesIngested: number;
  symbolsProcessed: number;
  symbolCount: number;
  perSymbol: Array<{ symbol: string; articles: number }>;
}> {
  initDb();
  let total = 0;

  const normalized: NewsIngestTarget[] = (
    targets.length > 0 && typeof targets[0] === "string"
      ? (targets as string[]).map((symbol) => ({
          symbol,
          companyName: getSymbolEntry(symbol)?.companyName ?? symbol,
        }))
      : (targets as NewsIngestTarget[])
  ).filter((t) => t.symbol.trim());

  for (const feed of MARKET_FEEDS) {
    const items = await fetchFeed(feed.url);
    total += await upsertArticles(items);
  }

  const perSymbol: Array<{ symbol: string; articles: number }> = [];

  for (const { symbol, companyName } of normalized) {
    try {
      const items = await fetchCompanyNews(symbol, companyName);
      const count = await upsertArticles(items);
      total += count;
      perSymbol.push({ symbol, articles: count });
    } catch (error) {
      console.warn(`Company news failed for ${symbol}:`, error);
      perSymbol.push({ symbol, articles: 0 });
    }
  }

  await recomputeDailySentiment(normalized.map((t) => t.symbol));
  return {
    articlesIngested: total,
    symbolsProcessed: perSymbol.filter((r) => r.articles > 0).length,
    symbolCount: normalized.length,
    perSymbol,
  };
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
    sentimentSource: SentimentSource;
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
      sentimentSource: (row.sentimentSource ?? "rules") as SentimentSource,
    }));
}

export async function getSentimentMlCoverage(symbol: string, days = 7): Promise<number> {
  const articles = await getArticlesForSymbol(symbol, days);
  if (articles.length === 0) return 0;
  const ml = articles.filter((a) => a.sentimentSource !== "rules").length;
  return ml / articles.length;
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
