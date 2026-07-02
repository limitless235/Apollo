/**
 * Rescore all articles with FinBERT/hybrid sentiment.
 * Usage: npm run rescore-sentiment
 */
import { eq } from "drizzle-orm";
import { initDb, getDb } from "../src/lib/db";
import { articles } from "../src/lib/db/schema";
import { analyzeSentiment } from "../src/lib/news/sentiment";
import { recomputeDailySentiment } from "../src/lib/news/rss-fetcher";
import { getWatchlistSymbols } from "../src/lib/watchlist";

async function main() {
  initDb();
  const db = getDb();
  const rows = await db.select().from(articles).orderBy(articles.publishedAt);

  if (rows.length === 0) {
    console.log("No articles in database. Run: npm run ingest");
    process.exit(0);
  }

  const mode = process.env.SENTIMENT_MODEL ?? "hybrid";
  console.log(`\nRescoring ${rows.length} articles (mode: ${mode})...\n`);

  let updated = 0;
  const sourceCounts = { rules: 0, finbert: 0, hybrid: 0 };

  for (const row of rows) {
    const text = `${row.title} ${row.summary ?? ""}`.trim();
    const result = await analyzeSentiment(text);

    await db
      .update(articles)
      .set({
        sentimentScore: result.score,
        sentimentSource: result.source,
      })
      .where(eq(articles.id, row.id));

    sourceCounts[result.source]++;
    updated++;

    if (updated % 25 === 0 || updated === rows.length) {
      process.stdout.write(`\r  ${updated}/${rows.length} rescored`);
    }
  }

  console.log("\n\nRecomputing daily sentiment aggregates...");
  const symbols = await getWatchlistSymbols();
  await recomputeDailySentiment(symbols);

  console.log("\n── Summary ──");
  console.log(`  Updated: ${updated}`);
  console.log(`  Hybrid:  ${sourceCounts.hybrid}`);
  console.log(`  FinBERT: ${sourceCounts.finbert}`);
  console.log(`  Rules:   ${sourceCounts.rules}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
