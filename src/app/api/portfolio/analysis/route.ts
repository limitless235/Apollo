import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { analyzePortfolio } from "@/lib/portfolio";

export async function GET() {
  initDb();
  const analysis = await analyzePortfolio();
  return NextResponse.json(analysis);
}
