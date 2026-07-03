import { NextResponse } from "next/server";
import { searchSymbolsWithYahoo } from "@/lib/symbols/registry";
import { searchYahooMutualFunds } from "@/lib/prices/yfinance";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const type = searchParams.get("type") ?? "equity";

  if (type === "mf") {
    const funds = await searchYahooMutualFunds(q, 12);
    return NextResponse.json({
      results: funds.map((f) => ({
        symbol: f.symbol,
        companyName: f.schemeName,
        yfinanceTicker: f.yfinanceTicker,
        exchange: "BSE" as const,
        assetType: "mf" as const,
        source: "yahoo" as const,
      })),
    });
  }

  const includeBse = searchParams.get("includeBse") !== "0";
  const results = await searchSymbolsWithYahoo(q, 12, { includeBse });
  return NextResponse.json({ results });
}
