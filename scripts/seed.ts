import symbolsData from "@/data/nse-symbols.json";
import { initDb } from "@/lib/db";
import { seedWatchlist } from "@/lib/watchlist";

async function main() {
  initDb();
  const count = await seedWatchlist();
  console.log(`Seeded watchlist with ${count} NIFTY symbols`);
  console.log(`Registry has ${symbolsData.length} symbols`);
}

main().catch(console.error);
