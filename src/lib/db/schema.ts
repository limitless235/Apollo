import { sqliteTable, text, real, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary"),
  source: text("source"),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  symbols: text("symbols").notNull().default("[]"),
  sentimentScore: real("sentiment_score").notNull().default(0),
  sentimentSource: text("sentiment_source").notNull().default("rules"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const dailySentiment = sqliteTable(
  "daily_sentiment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    avgSentiment: real("avg_sentiment").notNull().default(0),
    articleCount: integer("article_count").notNull().default(0),
    bullishCount: integer("bullish_count").notNull().default(0),
    bearishCount: integer("bearish_count").notNull().default(0),
  },
  (table) => [uniqueIndex("daily_sentiment_symbol_date").on(table.symbol, table.date)]
);

export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  companyName: text("company_name").notNull(),
  addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
});

export type Article = typeof articles.$inferSelect;
export type DailySentiment = typeof dailySentiment.$inferSelect;
export type WatchlistItem = typeof watchlist.$inferSelect;
