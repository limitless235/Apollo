import { initDb } from "@/lib/db";
import { ingestWatchlist } from "@/lib/news/rss-fetcher";
import { getWatchlistSymbols } from "@/lib/watchlist";

async function main() {
  initDb();
  const symbols = await getWatchlistSymbols();
  console.log(`Ingesting news for ${symbols.length} symbols...`);
  const result = await ingestWatchlist(symbols);
  console.log(`Done: ${result.articlesIngested} articles, ${result.symbolsProcessed} symbols`);
  process.exit(0);
}

main().catch(console.error);
