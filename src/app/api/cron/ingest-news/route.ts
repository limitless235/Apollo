import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { ingestWatchlist } from "@/lib/news/rss-fetcher";
import { getWatchlistSymbols } from "@/lib/watchlist";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  initDb();
  const symbols = await getWatchlistSymbols();

  if (symbols.length === 0) {
    return NextResponse.json({ error: "Watchlist empty" }, { status: 400 });
  }

  const result = await ingestWatchlist(symbols);
  return NextResponse.json({
    ok: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
