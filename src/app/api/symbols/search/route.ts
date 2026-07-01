import { NextResponse } from "next/server";
import { searchSymbols } from "@/lib/symbols/registry";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const results = searchSymbols(q, 10);
  return NextResponse.json({ results });
}
