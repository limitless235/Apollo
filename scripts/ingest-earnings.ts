import { initDb } from "@/lib/db";
import { ingestEarningsEvents } from "@/lib/earnings/ingest";

async function main() {
  initDb();
  console.log("\nApollo earnings ingest\n");

  const result = await ingestEarningsEvents(
    Number(process.env.EARNINGS_LOOKBACK_DAYS ?? "500")
  );

  console.log(`Symbols processed: ${result.symbolsProcessed}`);
  console.log(`NSE events:        ${result.nseEvents}`);
  console.log(`Fallback events:   ${result.fallbackEvents}`);
  console.log(`Upserted:          ${result.eventsUpserted}`);
  console.log(`Total in DB:       ${result.totalInDb}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
