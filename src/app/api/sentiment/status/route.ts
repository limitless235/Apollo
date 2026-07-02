import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { isFinbertAvailable, FINBERT_MODEL, getSentimentModelLabel } from "@/lib/news/sentiment";
import { sql } from "drizzle-orm";

export async function GET() {
  initDb();
  const db = getDb();

  const finbertReady = await isFinbertAvailable();
  const mode = process.env.SENTIMENT_MODEL ?? "hybrid";

  const counts = await db
    .select({
      source: articles.sentimentSource,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(articles)
    .groupBy(articles.sentimentSource);

  const total = counts.reduce((s, c) => s + c.count, 0);

  return NextResponse.json({
    model: FINBERT_MODEL,
    mode,
    finbertReady,
    label: getSentimentModelLabel(
      mode === "rules" ? "rules" : mode === "finbert" ? "finbert" : "hybrid"
    ),
    articlesTotal: total,
    bySource: Object.fromEntries(counts.map((c) => [c.source, c.count])),
  });
}
