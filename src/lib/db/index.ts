import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
  db?: ReturnType<typeof drizzle>;
};

function getSqlite() {
  if (!globalForDb.sqlite) {
    const path = process.env.DATABASE_PATH ?? "./apollo.db";
    globalForDb.sqlite = new Database(path);
    globalForDb.sqlite.pragma("journal_mode = WAL");
  }
  return globalForDb.sqlite;
}

export function getDb() {
  if (!globalForDb.db) {
    globalForDb.db = drizzle(getSqlite(), { schema });
  }
  return globalForDb.db;
}

export function initDb() {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      published_at INTEGER NOT NULL,
      symbols TEXT NOT NULL DEFAULT '[]',
      sentiment_score REAL NOT NULL DEFAULT 0,
      sentiment_source TEXT NOT NULL DEFAULT 'rules',
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_sentiment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      avg_sentiment REAL NOT NULL DEFAULT 0,
      article_count INTEGER NOT NULL DEFAULT 0,
      bullish_count INTEGER NOT NULL DEFAULT 0,
      bearish_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(symbol, date)
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      avg_cost REAL NOT NULL,
      yfinance_ticker TEXT,
      notes TEXT,
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
    CREATE INDEX IF NOT EXISTS idx_daily_sentiment_symbol ON daily_sentiment(symbol, date);
    CREATE INDEX IF NOT EXISTS idx_portfolio_symbol ON portfolio_holdings(symbol);
  `);
  try {
    sqlite.exec(`ALTER TABLE articles ADD COLUMN sentiment_source TEXT NOT NULL DEFAULT 'rules'`);
  } catch {
    // column already exists
  }
  return getDb();
}
