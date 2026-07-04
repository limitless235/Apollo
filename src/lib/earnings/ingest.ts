import PQueue from "p-queue";
import { getSymbolEntry } from "@/lib/symbols/registry";
import { getNewsIngestTargets } from "@/lib/news/ingest-targets";
import {
  fetchNseEarningsAnnouncements,
  fetchYfinanceEarningsDates,
} from "./nse-fetcher";
import { upsertEarningsEvents, countEarningsEvents } from "./store";
import type { EarningsEventRecord } from "./types";

const queue = new PQueue({ concurrency: 2, interval: 500, intervalCap: 2 });

export interface EarningsIngestResult {
  symbolsProcessed: number;
  eventsUpserted: number;
  nseEvents: number;
  fallbackEvents: number;
  totalInDb: number;
}

export async function ingestEarningsEvents(
  lookbackDays = 500
): Promise<EarningsIngestResult> {
  const targets = await getNewsIngestTargets();
  const allowedSymbols = new Set(targets.map((t) => t.symbol.toUpperCase()));

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - lookbackDays);

  console.log(
    `Fetching NSE earnings announcements ${fromDate.toISOString().slice(0, 10)} → ${toDate.toISOString().slice(0, 10)}...`
  );

  const nseRows = await fetchNseEarningsAnnouncements(fromDate, toDate, allowedSymbols);
  console.log(`  NSE announcements matched: ${nseRows.length}`);

  const nseSymbols = new Set(nseRows.map((r) => r.symbol));
  const fallbackRows: EarningsEventRecord[] = [];

  // Fallback for symbols with no NSE hit — yfinance calendar (dates only)
  const missing = targets.filter((t) => !nseSymbols.has(t.symbol.toUpperCase()));
  if (missing.length > 0) {
    console.log(`  Fetching yfinance earnings fallback for ${missing.length} symbols...`);
    await Promise.all(
      missing.map((t) =>
        queue.add(async () => {
          const entry = getSymbolEntry(t.symbol);
          if (!entry) return;
          const rows = await fetchYfinanceEarningsDates(t.symbol, entry.yfinanceTicker);
          fallbackRows.push(...rows);
        })
      )
    );
    console.log(`  yfinance fallback events: ${fallbackRows.length}`);
  }

  const allRows = dedupeEvents([...nseRows, ...fallbackRows]);
  const upserted = await upsertEarningsEvents(allRows);
  const totalInDb = await countEarningsEvents();

  return {
    symbolsProcessed: targets.length,
    eventsUpserted: upserted,
    nseEvents: nseRows.length,
    fallbackEvents: fallbackRows.length,
    totalInDb,
  };
}

function dedupeEvents(rows: EarningsEventRecord[]): EarningsEventRecord[] {
  const map = new Map<string, EarningsEventRecord>();
  const priority: Record<string, number> = {
    nse_announcement: 3,
    screener_in: 2,
    manual: 2,
    yfinance_fallback: 1,
  };

  for (const row of rows) {
    const key = `${row.symbol}|${row.eventDate}`;
    const existing = map.get(key);
    if (!existing || priority[row.source] > priority[existing.source]) {
      map.set(key, row);
    }
  }

  return [...map.values()];
}
