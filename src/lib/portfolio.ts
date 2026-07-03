import fs from "fs";
import path from "path";
import { initDb, getDb } from "@/lib/db";
import { portfolioHoldings, type PortfolioAssetType, type PortfolioHolding } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSymbolEntry, registerCustomSymbol } from "@/lib/symbols/registry";
import { fetchMarketQuoteReliable, searchYahooIndianSymbols, searchYahooMutualFunds } from "@/lib/prices/yfinance";
import { getSentimentTimeline } from "@/lib/news/rss-fetcher";
import {
  computeWatchlistSignals,
  generateTradeRecommendation,
  backtestSymbol,
} from "@/lib/scoring";
import { fetchOhlcv as fetchOhlcvDirect } from "@/lib/prices/yfinance";
import type { TradeRecommendation } from "@/lib/scoring/recommendation";
import type { SignalLabel } from "@/lib/scoring/composite";

const BACKUP_PATH = path.join(process.cwd(), "data", "portfolio-holdings.json");

export interface PortfolioHoldingInput {
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: number;
  avgCost: number;
  yfinanceTicker?: string | null;
  notes?: string | null;
}

export interface AnalyzedHolding {
  id: number;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: number;
  avgCost: number;
  notes: string | null;
  yfinanceTicker: string | null;
  currentPrice: number | null;
  priceSource: "live" | "cost" | "unavailable";
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  weight: number;
  changePercent: number | null;
  score: number | null;
  rank: number | null;
  label: SignalLabel | null;
  recommendation: TradeRecommendation | null;
  tickerWarning: string | null;
}

export interface PortfolioAnalysis {
  updatedAt: string;
  holdingCount: number;
  totals: {
    invested: number;
    current: number;
    pnl: number;
    pnlPercent: number;
    pricedHoldings: number;
    unpricedHoldings: number;
    byAssetType: {
      stock: { invested: number; current: number; count: number };
      etf: { invested: number; current: number; count: number };
      mf: { invested: number; current: number; count: number };
    };
  };
  allocation: {
    stock: number;
    etf: number;
    mf: number;
  };
  holdings: AnalyzedHolding[];
  actions: {
    trim: string[];
    hold: string[];
    add: string[];
    review: string[];
  };
}

const ASSET_TYPES: PortfolioAssetType[] = ["stock", "etf", "mf"];

let portfolioReady = false;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeAssetType(value: string): PortfolioAssetType {
  const v = value.toLowerCase();
  if (ASSET_TYPES.includes(v as PortfolioAssetType)) return v as PortfolioAssetType;
  throw new Error("assetType must be stock, etf, or mf");
}

export function tickerBase(ticker: string): string {
  return ticker.replace(/\.(NS|BO|NF)$/i, "").toUpperCase();
}

export function tickerMatchesSymbol(ticker: string | null | undefined, symbol: string): boolean {
  if (!ticker?.trim()) return false;
  return tickerBase(ticker) === symbol.trim().toUpperCase();
}

function preferredExchange(ticker: string | null | undefined): "NSE" | "BSE" {
  return ticker?.toUpperCase().endsWith(".BO") ? "BSE" : "NSE";
}

function defaultTicker(symbol: string, exchange: "NSE" | "BSE" = "NSE"): string {
  return `${symbol.trim().toUpperCase()}.${exchange === "BSE" ? "BO" : "NS"}`;
}

async function resolveTickerExact(
  input: Pick<PortfolioHoldingInput, "symbol" | "name" | "assetType" | "yfinanceTicker">
): Promise<string | null> {
  const symbol = input.symbol.trim().toUpperCase();

  if (input.yfinanceTicker?.trim()) {
    return input.yfinanceTicker.trim();
  }

  if (input.assetType === "mf") {
    if (input.yfinanceTicker?.trim()) return input.yfinanceTicker.trim();
    if (symbol.endsWith(".BO") || symbol.endsWith(".NS")) return symbol;
    if (/^\d+$/.test(symbol)) return `${symbol}.BO`;

    const yahoo = await searchYahooMutualFunds(input.name || symbol, 8);
    const exact =
      yahoo.find((r) => r.symbol === symbol) ??
      yahoo.find((r) => r.schemeName.toLowerCase() === input.name?.toLowerCase()) ??
      yahoo[0];
    if (exact) return exact.yfinanceTicker;

    return null;
  }

  const exchange = preferredExchange(input.yfinanceTicker);

  const entry = getSymbolEntry(symbol);
  if (entry && entry.symbol.toUpperCase() === symbol && exchange === "NSE") {
    return entry.yfinanceTicker;
  }

  const yahoo = await searchYahooIndianSymbols(symbol, 8);
  const exact =
    yahoo.find((r) => r.symbol === symbol && r.exchange === exchange) ??
    yahoo.find((r) => r.symbol === symbol);
  if (exact) return exact.yfinanceTicker;

  return defaultTicker(symbol, exchange);
}

function syncPortfolioBackup(rows: PortfolioHolding[]): void {
  try {
    fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
    fs.writeFileSync(
      BACKUP_PATH,
      JSON.stringify(
        rows.map((h) => ({
          id: h.id,
          symbol: h.symbol,
          name: h.name,
          assetType: h.assetType,
          quantity: h.quantity,
          avgCost: h.avgCost,
          yfinanceTicker: h.yfinanceTicker,
          notes: h.notes,
          addedAt: h.addedAt,
          updatedAt: h.updatedAt,
        })),
        null,
        2
      )
    );
  } catch (error) {
    console.error("Portfolio backup write failed:", error);
  }
}

async function restorePortfolioFromBackupIfEmpty(): Promise<number> {
  initDb();
  const db = getDb();
  const existing = await db.select().from(portfolioHoldings);
  if (existing.length > 0) return 0;
  if (!fs.existsSync(BACKUP_PATH)) return 0;

  try {
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf-8")) as Array<
      Omit<PortfolioHolding, "addedAt" | "updatedAt"> & {
        addedAt: string | Date;
        updatedAt: string | Date;
      }
    >;

    let restored = 0;
    for (const row of raw) {
      await db.insert(portfolioHoldings).values({
        symbol: row.symbol,
        name: row.name,
        assetType: row.assetType,
        quantity: row.quantity,
        avgCost: row.avgCost,
        yfinanceTicker: row.yfinanceTicker,
        notes: row.notes,
        addedAt: new Date(row.addedAt),
        updatedAt: new Date(row.updatedAt),
      });
      restored++;
    }
    return restored;
  } catch (error) {
    console.error("Portfolio backup restore failed:", error);
    return 0;
  }
}

export async function repairPortfolioTickers(): Promise<number> {
  initDb();
  const db = getDb();
  const holdings = await db.select().from(portfolioHoldings);
  let fixed = 0;

  for (const h of holdings) {
    if (tickerMatchesSymbol(h.yfinanceTicker, h.symbol)) continue;

    let correctTicker: string | null = null;

    if (h.assetType === "mf") {
      if (h.yfinanceTicker?.trim()) {
        correctTicker = h.yfinanceTicker;
      } else if (h.symbol.endsWith(".BO") || h.symbol.endsWith(".NS")) {
        correctTicker = h.symbol;
      } else if (/^\d+$/.test(h.symbol)) {
        correctTicker = `${h.symbol}.BO`;
      } else {
        const yahoo = await searchYahooMutualFunds(h.name || h.symbol, 5);
        correctTicker = yahoo.find((r) => r.symbol === h.symbol)?.yfinanceTicker ?? yahoo[0]?.yfinanceTicker ?? null;
      }
    } else {
      const exchange = preferredExchange(h.yfinanceTicker);
      const entry = getSymbolEntry(h.symbol);
      if (entry && entry.symbol.toUpperCase() === h.symbol && exchange === "NSE") {
        correctTicker = entry.yfinanceTicker;
      } else {
        const yahoo = await searchYahooIndianSymbols(h.symbol, 8);
        const exact =
          yahoo.find((r) => r.symbol === h.symbol && r.exchange === exchange) ??
          yahoo.find((r) => r.symbol === h.symbol);
        correctTicker = exact?.yfinanceTicker ?? defaultTicker(h.symbol, exchange);
      }
    }

    if (!correctTicker) continue;

    await db
      .update(portfolioHoldings)
      .set({ yfinanceTicker: correctTicker, updatedAt: new Date() })
      .where(eq(portfolioHoldings.id, h.id));
    fixed++;
  }

  return fixed;
}

export async function ensurePortfolioReady(): Promise<void> {
  if (portfolioReady) return;
  initDb();
  await restorePortfolioFromBackupIfEmpty();
  await repairPortfolioTickers();
  const rows = await getDb().select().from(portfolioHoldings);
  syncPortfolioBackup(rows);
  portfolioReady = true;
}

export async function getPortfolioHoldings(): Promise<PortfolioHolding[]> {
  await ensurePortfolioReady();
  const db = getDb();
  return db
    .select()
    .from(portfolioHoldings)
    .orderBy(portfolioHoldings.updatedAt);
}

async function persistBackup(): Promise<void> {
  const rows = await getDb().select().from(portfolioHoldings);
  syncPortfolioBackup(rows);
}

export async function addPortfolioHolding(input: PortfolioHoldingInput): Promise<PortfolioHolding> {
  await ensurePortfolioReady();
  const db = getDb();
  const assetType = normalizeAssetType(input.assetType);
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();
  const quantity = Number(input.quantity);
  const avgCost = Number(input.avgCost);

  if (!symbol || !name) throw new Error("symbol and name are required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be > 0");
  if (!Number.isFinite(avgCost) || avgCost <= 0) throw new Error("avgCost must be > 0");

  const yfinanceTicker = await resolveTickerExact({ ...input, symbol, assetType });
  const now = new Date();

  if (assetType !== "mf" && yfinanceTicker) {
    registerCustomSymbol({
      symbol,
      companyName: name,
      yfinanceTicker,
      aliases: [name.toLowerCase()],
    });
  }

  const [row] = await db
    .insert(portfolioHoldings)
    .values({
      symbol,
      name,
      assetType,
      quantity,
      avgCost,
      yfinanceTicker,
      notes: input.notes?.trim() || null,
      addedAt: now,
      updatedAt: now,
    })
    .returning();

  await persistBackup();
  return row;
}

export async function updatePortfolioHolding(
  id: number,
  input: Partial<PortfolioHoldingInput>
): Promise<PortfolioHolding | null> {
  await ensurePortfolioReady();
  const db = getDb();
  const existing = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.id, id))
    .limit(1);

  if (!existing[0]) return null;

  const merged = {
    symbol: input.symbol?.trim().toUpperCase() ?? existing[0].symbol,
    name: input.name?.trim() ?? existing[0].name,
    assetType: input.assetType
      ? normalizeAssetType(input.assetType)
      : (existing[0].assetType as PortfolioAssetType),
    quantity: input.quantity != null ? Number(input.quantity) : existing[0].quantity,
    avgCost: input.avgCost != null ? Number(input.avgCost) : existing[0].avgCost,
    notes: input.notes !== undefined ? input.notes?.trim() || null : existing[0].notes,
    yfinanceTicker:
      input.yfinanceTicker !== undefined
        ? input.yfinanceTicker?.trim() || null
        : existing[0].yfinanceTicker,
  };

  if (merged.quantity <= 0 || merged.avgCost <= 0) {
    throw new Error("quantity and avgCost must be > 0");
  }

  const yfinanceTicker = await resolveTickerExact(merged);

  const [row] = await db
    .update(portfolioHoldings)
    .set({
      ...merged,
      yfinanceTicker,
      updatedAt: new Date(),
    })
    .where(eq(portfolioHoldings.id, id))
    .returning();

  await persistBackup();
  return row ?? null;
}

export async function removePortfolioHolding(id: number): Promise<boolean> {
  await ensurePortfolioReady();
  const db = getDb();
  const result = await db.delete(portfolioHoldings).where(eq(portfolioHoldings.id, id));
  const removed = (result.changes ?? 0) > 0;
  if (removed) await persistBackup();
  return removed;
}

async function fetchPriceForHolding(
  symbol: string,
  yfinanceTicker: string | null,
  assetType?: PortfolioAssetType
): Promise<{ price: number; changePercent: number } | null> {
  if (!yfinanceTicker) return null;
  if (assetType !== "mf" && !tickerMatchesSymbol(yfinanceTicker, symbol)) return null;

  const quote = await fetchMarketQuoteReliable(yfinanceTicker);
  if (quote) {
    return { price: quote.price, changePercent: quote.changePercent };
  }

  const ohlcv = await fetchOhlcvDirect(yfinanceTicker, 5);
  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  if (!last) return null;

  const changePercent =
    prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { price: last.close, changePercent };
}

export async function analyzePortfolio(): Promise<PortfolioAnalysis> {
  await ensurePortfolioReady();
  const holdings = await getPortfolioHoldings();

  if (holdings.length === 0) {
    return {
      updatedAt: new Date().toISOString(),
      holdingCount: 0,
      totals: {
        invested: 0,
        current: 0,
        pnl: 0,
        pnlPercent: 0,
        pricedHoldings: 0,
        unpricedHoldings: 0,
        byAssetType: {
          stock: { invested: 0, current: 0, count: 0 },
          etf: { invested: 0, current: 0, count: 0 },
          mf: { invested: 0, current: 0, count: 0 },
        },
      },
      allocation: { stock: 0, etf: 0, mf: 0 },
      holdings: [],
      actions: { trim: [], hold: [], add: [], review: [] },
    };
  }

  const scorable = holdings.filter((h) => h.assetType === "stock" || h.assetType === "etf");
  const signalItems = scorable.map((h) => ({ symbol: h.symbol, companyName: h.name }));
  const signals = signalItems.length > 0 ? await computeWatchlistSignals(signalItems) : [];

  const priceByTicker = new Map<string, { price: number; changePercent: number }>();
  await Promise.all(
    holdings.map(async (h) => {
      if (!h.yfinanceTicker) return;
      const px = await fetchPriceForHolding(h.symbol, h.yfinanceTicker, h.assetType as PortfolioAssetType);
      if (px) priceByTicker.set(h.yfinanceTicker, px);
    })
  );

  const analyzed: AnalyzedHolding[] = [];

  for (const h of holdings) {
    const quantity = h.quantity;
    const avgCost = h.avgCost;
    const investedValue = roundMoney(quantity * avgCost);

    const tickerWarning =
      h.assetType !== "mf" && !tickerMatchesSymbol(h.yfinanceTicker, h.symbol)
        ? `Price ticker ${h.yfinanceTicker ?? "missing"} does not match ${h.symbol} — repair pending`
        : h.assetType === "mf" && !h.yfinanceTicker
          ? "No Yahoo ticker — add via search or scheme code for live NAV"
          : null;

    const live = h.yfinanceTicker ? priceByTicker.get(h.yfinanceTicker) : undefined;
    let currentPrice: number | null = live?.price ?? null;
    let priceSource: AnalyzedHolding["priceSource"] = "unavailable";
    let changePercent: number | null = live?.changePercent ?? null;

    if (currentPrice != null) {
      priceSource = "live";
    } else if (h.assetType === "mf") {
      currentPrice = avgCost;
      priceSource = "cost";
    }

    const currentValue =
      currentPrice != null ? roundMoney(quantity * currentPrice) : investedValue;
    const pnl = roundMoney(currentValue - investedValue);
    const pnlPercent =
      investedValue > 0 && currentPrice != null
        ? roundMoney(((currentPrice! - avgCost) / avgCost) * 100)
        : 0;

    const signal = signals.find((s) => s.symbol === h.symbol);
    let recommendation: TradeRecommendation | null = null;

    if (signal && (h.assetType === "stock" || h.assetType === "etf")) {
      const entry = getSymbolEntry(h.symbol);
      if (entry) {
        const [backtestOhlcv, timeline] = await Promise.all([
          fetchOhlcvDirect(entry.yfinanceTicker, 365),
          getSentimentTimeline(h.symbol, 60),
        ]);
        const backtest = backtestSymbol(h.symbol, backtestOhlcv, timeline);
        const chartChange90d =
          backtestOhlcv.length >= 2
            ? ((backtestOhlcv[backtestOhlcv.length - 1].close - backtestOhlcv[0].close) /
                backtestOhlcv[0].close) *
              100
            : undefined;

        recommendation = generateTradeRecommendation({
          symbol: signal.symbol,
          companyName: signal.companyName,
          score: signal.score,
          heuristicScore: signal.heuristicScore,
          learnedScore: signal.learnedScore,
          label: signal.label,
          rank: signal.rank,
          watchlistSize: signalItems.length,
          momentum5d: signal.features.momentum5d,
          momentum20d: signal.features.momentum20d,
          avgSentiment7d: signal.features.avgSentiment7d,
          sentimentDelta: signal.features.sentimentDelta,
          newsCount7d: signal.features.newsCount7d,
          volatility20d: signal.features.volatility20d,
          volumeZScore: signal.features.volumeZScore,
          changePercent: changePercent ?? 0,
          backtestIc: backtest.ic,
          backtestDa: backtest.directionalAccuracy,
          backtestDays: backtest.days,
          chartChange90d,
        });
      }
    }

    analyzed.push({
      id: h.id,
      symbol: h.symbol,
      name: h.name,
      assetType: h.assetType as PortfolioAssetType,
      quantity,
      avgCost,
      notes: h.notes,
      yfinanceTicker: h.yfinanceTicker,
      currentPrice: currentPrice != null ? roundMoney(currentPrice) : null,
      priceSource,
      investedValue,
      currentValue,
      pnl,
      pnlPercent,
      weight: 0,
      changePercent: changePercent != null ? roundMoney(changePercent) : null,
      score: signal?.score ?? null,
      rank: signal?.rank ?? null,
      label: signal?.label ?? null,
      recommendation,
      tickerWarning,
    });
  }

  const priced = analyzed.filter((h) => h.priceSource === "live");
  const totalCurrent = roundMoney(priced.reduce((s, h) => s + h.currentValue, 0));
  const totalInvested = roundMoney(analyzed.reduce((s, h) => s + h.investedValue, 0));
  const pricedInvested = roundMoney(priced.reduce((s, h) => s + h.investedValue, 0));
  const totalPnl = roundMoney(totalCurrent - pricedInvested);

  const byAssetType = {
    stock: { invested: 0, current: 0, count: 0 },
    etf: { invested: 0, current: 0, count: 0 },
    mf: { invested: 0, current: 0, count: 0 },
  };
  for (const h of analyzed) {
    const bucket = byAssetType[h.assetType];
    bucket.count += 1;
    bucket.invested = roundMoney(bucket.invested + h.investedValue);
    if (h.priceSource === "live") {
      bucket.current = roundMoney(bucket.current + h.currentValue);
    }
  }

  for (const h of analyzed) {
    h.weight =
      totalCurrent > 0 && h.priceSource === "live"
        ? roundMoney((h.currentValue / totalCurrent) * 100)
        : 0;
  }

  const allocation = { stock: 0, etf: 0, mf: 0 };
  for (const h of analyzed) {
    if (h.priceSource === "live") allocation[h.assetType] += h.weight;
  }

  const actions = { trim: [] as string[], hold: [] as string[], add: [] as string[], review: [] as string[] };
  for (const h of analyzed) {
    const rec = h.recommendation?.action;
    if (rec === "SELL" || rec === "AVOID") actions.trim.push(h.symbol);
    else if (rec === "BUY") actions.add.push(h.symbol);
    else if (rec === "HOLD") actions.hold.push(h.symbol);
    if (h.tickerWarning) actions.review.push(h.symbol);
    if (h.assetType === "mf" && h.priceSource !== "live") actions.review.push(h.symbol);
    if (h.weight >= 25) actions.review.push(h.symbol);
  }

  return {
    updatedAt: new Date().toISOString(),
    holdingCount: analyzed.length,
    totals: {
      invested: totalInvested,
      current: totalCurrent,
      pnl: totalPnl,
      pnlPercent:
        pricedInvested > 0 ? roundMoney((totalPnl / pricedInvested) * 100) : 0,
      pricedHoldings: priced.length,
      unpricedHoldings: analyzed.length - priced.length,
      byAssetType,
    },
    allocation,
    holdings: analyzed.sort((a, b) => b.currentValue - a.currentValue),
    actions: {
      trim: [...new Set(actions.trim)],
      hold: [...new Set(actions.hold)],
      add: [...new Set(actions.add)],
      review: [...new Set(actions.review)],
    },
  };
}
