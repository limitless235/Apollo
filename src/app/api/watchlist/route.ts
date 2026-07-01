import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/watchlist";

export async function GET() {
  initDb();
  const items = await getWatchlist();
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  initDb();
  const body = await request.json();
  const { symbol } = body;

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const entry = await addToWatchlist(symbol);
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  initDb();
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  await removeFromWatchlist(symbol);
  return NextResponse.json({ ok: true });
}
