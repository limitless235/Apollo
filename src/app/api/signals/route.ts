import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getWatchlist } from "@/lib/watchlist";
import { computeWatchlistSignals } from "@/lib/scoring";

export async function GET() {
  initDb();
  const watchlist = await getWatchlist();
  const signals = await computeWatchlistSignals(watchlist);

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    count: signals.length,
    items: signals,
  });
}
