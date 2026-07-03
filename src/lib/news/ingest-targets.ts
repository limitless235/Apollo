import { getWatchlist } from "@/lib/watchlist";
import { getPortfolioHoldings } from "@/lib/portfolio";
import { getSymbolEntry, registerCustomSymbol } from "@/lib/symbols/registry";

export interface NewsIngestTarget {
  symbol: string;
  companyName: string;
}

/** Watchlist + portfolio stocks/ETFs (deduped), with registry entries ensured. */
export async function getNewsIngestTargets(): Promise<NewsIngestTarget[]> {
  const [watchlist, portfolio] = await Promise.all([
    getWatchlist(),
    getPortfolioHoldings(),
  ]);

  const bySymbol = new Map<string, NewsIngestTarget>();

  for (const item of watchlist) {
    bySymbol.set(item.symbol, { symbol: item.symbol, companyName: item.companyName });
  }

  for (const holding of portfolio) {
    if (holding.assetType === "mf") continue;

    const existing = getSymbolEntry(holding.symbol);
    const companyName = holding.name || existing?.companyName || holding.symbol;
    const yfinanceTicker =
      holding.yfinanceTicker ?? existing?.yfinanceTicker ?? `${holding.symbol}.NS`;

    if (!existing) {
      registerCustomSymbol({
        symbol: holding.symbol,
        companyName,
        yfinanceTicker,
        aliases: [companyName.toLowerCase()],
      });
    }

    if (!bySymbol.has(holding.symbol)) {
      bySymbol.set(holding.symbol, { symbol: holding.symbol, companyName });
    }
  }

  return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}
