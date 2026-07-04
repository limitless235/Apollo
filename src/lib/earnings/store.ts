import { initDb, getDb } from "@/lib/db";
import { earningsEvents } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { EarningsEventRecord, EarningsSource } from "./types";

export async function upsertEarningsEvents(rows: EarningsEventRecord[]): Promise<number> {
  if (rows.length === 0) return 0;
  initDb();
  const db = getDb();
  let upserted = 0;

  for (const row of rows) {
    await db
      .insert(earningsEvents)
      .values({
        symbol: row.symbol.toUpperCase(),
        eventDate: row.eventDate,
        actualEps: row.actualEps,
        estimateEps: row.estimateEps,
        source: row.source,
      })
      .onConflictDoUpdate({
        target: [earningsEvents.symbol, earningsEvents.eventDate],
        set: {
          actualEps: row.actualEps,
          estimateEps: row.estimateEps,
          source: row.source,
        },
      });
    upserted++;
  }

  return upserted;
}

export async function loadEarningsForSymbol(symbol: string): Promise<EarningsEventRecord[]> {
  initDb();
  const db = getDb();
  const rows = await db
    .select()
    .from(earningsEvents)
    .where(eq(earningsEvents.symbol, symbol.toUpperCase()));

  return rows.map((r) => ({
    symbol: r.symbol,
    eventDate: r.eventDate,
    actualEps: r.actualEps,
    estimateEps: r.estimateEps,
    source: r.source as EarningsSource,
  }));
}

export async function loadEarningsBySymbols(
  symbols: string[]
): Promise<Map<string, EarningsEventRecord[]>> {
  initDb();
  const db = getDb();
  const upper = symbols.map((s) => s.toUpperCase());
  if (upper.length === 0) return new Map();

  const rows = await db
    .select()
    .from(earningsEvents)
    .where(inArray(earningsEvents.symbol, upper));

  const map = new Map<string, EarningsEventRecord[]>();
  for (const r of rows) {
    const list = map.get(r.symbol) ?? [];
    list.push({
      symbol: r.symbol,
      eventDate: r.eventDate,
      actualEps: r.actualEps,
      estimateEps: r.estimateEps,
      source: r.source as EarningsSource,
    });
    map.set(r.symbol, list);
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  }

  return map;
}

export async function countEarningsEvents(): Promise<number> {
  initDb();
  const db = getDb();
  const rows = await db.select().from(earningsEvents);
  return rows.length;
}
