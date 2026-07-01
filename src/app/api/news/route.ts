import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getArticlesForSymbol } from "@/lib/news/rss-fetcher";

export async function GET(request: NextRequest) {
  initDb();
  const symbol = request.nextUrl.searchParams.get("symbol");
  const days = Number(request.nextUrl.searchParams.get("days") ?? 30);

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const articles = await getArticlesForSymbol(symbol.toUpperCase(), days);
  return NextResponse.json({ symbol: symbol.toUpperCase(), articles });
}
