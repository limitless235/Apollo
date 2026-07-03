import { initDb } from "@/lib/db";
import { ingestWatchlist } from "@/lib/news/rss-fetcher";
import { getNewsIngestTargets } from "@/lib/news/ingest-targets";
import { isFinbertAvailable, FINBERT_MODEL } from "@/lib/news/sentiment";

async function main() {
  initDb();
  const mode = process.env.SENTIMENT_MODEL ?? "hybrid";
  const finbertReady = await isFinbertAvailable();

  console.log(`\nApollo ingest — sentiment: ${mode}${finbertReady ? ` (${FINBERT_MODEL})` : " (rules fallback)"}\n`);

  const targets = await getNewsIngestTargets();
  console.log(`Ingesting news for ${targets.length} symbols (watchlist + portfolio)...`);
  const result = await ingestWatchlist(targets);
  console.log(
    `Done: ${result.articlesIngested} articles, ${result.symbolsProcessed}/${result.symbolCount} symbols with news`
  );

  const empty = result.perSymbol.filter((r) => r.articles === 0).map((r) => r.symbol);
  if (empty.length > 0) {
    console.log(`No articles returned for: ${empty.join(", ")}`);
  }

  if (!finbertReady && mode !== "rules") {
    console.log("\nTip: FinBERT did not load — articles scored with keyword rules.");
  } else if (mode !== "rules") {
    console.log("\nTip: Run `npm run rescore-sentiment` to refresh older rules-only articles.");
  }

  process.exit(0);
}

main().catch(console.error);
