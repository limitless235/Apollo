import { initDb, getDb } from "@/lib/db";
import { watchlist } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSymbolEntry, getAllSymbols, resolveSymbolEntry } from "@/lib/symbols/registry";

export async function getWatchlist() {
  initDb();
  const db = getDb();
  return db.select().from(watchlist).orderBy(watchlist.symbol);
}

export async function addToWatchlist(symbol: string) {
  initDb();
  const db = getDb();
  const entry = (await resolveSymbolEntry(symbol)) ?? getSymbolEntry(symbol);
  if (!entry) throw new Error(`Unknown symbol: ${symbol}`);

  await db
    .insert(watchlist)
    .values({
      symbol: entry.symbol,
      companyName: entry.companyName,
      addedAt: new Date(),
    })
    .onConflictDoNothing();

  return entry;
}

export async function removeFromWatchlist(symbol: string) {
  initDb();
  const db = getDb();
  await db.delete(watchlist).where(eq(watchlist.symbol, symbol.toUpperCase()));
}

export async function seedWatchlist() {
  initDb();
  const db = getDb();
  const symbols = getAllSymbols();
  const now = new Date();

  for (const entry of symbols) {
    await db
      .insert(watchlist)
      .values({
        symbol: entry.symbol,
        companyName: entry.companyName,
        addedAt: now,
      })
      .onConflictDoNothing();
  }

  return symbols.length;
}

export async function getWatchlistSymbols(): Promise<string[]> {
  const items = await getWatchlist();
  return items.map((i) => i.symbol);
}
