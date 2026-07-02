import { initDb } from "@/lib/db";
import { ingestWatchlist } from "@/lib/news/rss-fetcher";
import { getWatchlistSymbols } from "@/lib/watchlist";
import { isFinbertAvailable, FINBERT_MODEL } from "@/lib/news/sentiment";

async function main() {
  initDb();
  const mode = process.env.SENTIMENT_MODEL ?? "hybrid";
  const finbertReady = await isFinbertAvailable();

  console.log(`\nApollo ingest — sentiment: ${mode}${finbertReady ? ` (${FINBERT_MODEL})` : " (rules fallback)"}\n`);

  const symbols = await getWatchlistSymbols();
  console.log(`Ingesting news for ${symbols.length} symbols...`);
  const result = await ingestWatchlist(symbols);
  console.log(`Done: ${result.articlesIngested} articles, ${result.symbolsProcessed} symbols`);

  if (!finbertReady && mode !== "rules") {
    console.log("\nTip: FinBERT did not load — articles scored with keyword rules.");
  } else if (mode !== "rules") {
    console.log("\nTip: Run `npm run rescore-sentiment` to refresh older rules-only articles.");
  }

  process.exit(0);
}

main().catch(console.error);
