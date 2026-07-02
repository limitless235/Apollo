import { initDb, getDb } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import type { SentimentSource } from "@/lib/news/sentiment";

interface ArticleRow {
  symbols: string;
  publishedAt: Date;
  sentimentSource: string;
}

let articleCache: ArticleRow[] | null = null;

export async function initArticleCoverageCache(): Promise<void> {
  if (articleCache) return;
  initDb();
  const db = getDb();
  const rows = await db.select().from(articles);
  articleCache = rows.map((r) => ({
    symbols: r.symbols,
    publishedAt: r.publishedAt,
    sentimentSource: r.sentimentSource ?? "rules",
  }));
}

export function mlCoverageForSymbolWindow(
  symbol: string,
  asOfDate: string,
  windowDays = 7
): number {
  if (!articleCache) return 0;

  const end = new Date(`${asOfDate}T23:59:59Z`);
  const start = new Date(end);
  start.setDate(start.getDate() - windowDays);

  const sym = symbol.toUpperCase();
  const matched = articleCache.filter((row) => {
    const syms: string[] = JSON.parse(row.symbols);
    if (!syms.includes(sym)) return false;
    const t = row.publishedAt.getTime();
    return t >= start.getTime() && t <= end.getTime();
  });

  if (matched.length === 0) return 0;
  const ml = matched.filter((r) => (r.sentimentSource as SentimentSource) !== "rules").length;
  return ml / matched.length;
}

export function clearArticleCoverageCache(): void {
  articleCache = null;
}
