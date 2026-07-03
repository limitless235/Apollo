import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { ingestWatchlist } from "@/lib/news/rss-fetcher";
import { getNewsIngestTargets } from "@/lib/news/ingest-targets";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  initDb();
  const targets = await getNewsIngestTargets();

  if (targets.length === 0) {
    return NextResponse.json({ error: "No symbols to ingest" }, { status: 400 });
  }

  const result = await ingestWatchlist(targets);
  return NextResponse.json({
    ok: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
