import fs from "fs";
import path from "path";
import symbolsData from "@/data/nse-symbols.json";
import { searchYahooNseSymbols, searchYahooIndianSymbols, type YahooSearchResult } from "@/lib/prices/yfinance";

export interface SymbolEntry {
  symbol: string;
  companyName: string;
  yfinanceTicker: string;
  aliases: string[];
}

const staticRegistry: SymbolEntry[] = symbolsData as SymbolEntry[];
const CUSTOM_SYMBOLS_PATH = path.join(process.cwd(), "data", "custom-symbols.json");

let customRegistry: SymbolEntry[] = [];
let customLoaded = false;

function loadCustomRegistry(): SymbolEntry[] {
  if (customLoaded) return customRegistry;
  customLoaded = true;
  try {
    if (fs.existsSync(CUSTOM_SYMBOLS_PATH)) {
      customRegistry = JSON.parse(fs.readFileSync(CUSTOM_SYMBOLS_PATH, "utf-8")) as SymbolEntry[];
    }
  } catch {
    customRegistry = [];
  }
  return customRegistry;
}

function saveCustomRegistry() {
  fs.mkdirSync(path.dirname(CUSTOM_SYMBOLS_PATH), { recursive: true });
  fs.writeFileSync(CUSTOM_SYMBOLS_PATH, JSON.stringify(customRegistry, null, 2));
}

export function registerCustomSymbol(entry: SymbolEntry): SymbolEntry {
  loadCustomRegistry();
  const normalized = {
    ...entry,
    symbol: entry.symbol.toUpperCase(),
    aliases: entry.aliases ?? [],
  };
  const idx = customRegistry.findIndex((e) => e.symbol === normalized.symbol);
  if (idx >= 0) customRegistry[idx] = normalized;
  else customRegistry.push(normalized);
  saveCustomRegistry();
  return normalized;
}

function allRegistry(): SymbolEntry[] {
  return [...staticRegistry, ...loadCustomRegistry()];
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

function scoreEntry(entry: SymbolEntry, q: string): number {
  const symbol = entry.symbol.toLowerCase();
  const name = entry.companyName.toLowerCase();
  let score = 0;

  if (symbol === q) score += 10;
  else if (symbol.startsWith(q)) score += 6;
  else if (symbol.includes(q)) score += 3;

  if (name === q) score += 8;
  else if (name.startsWith(q)) score += 5;
  else if (name.includes(q)) score += 3;

  for (const word of name.split(/\s+/)) {
    if (word.startsWith(q)) score += 2;
  }

  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    if (a === q) score += 7;
    else if (a.startsWith(q)) score += 4;
    else if (a.includes(q)) score += 2;
  }

  return score;
}

export function getAllSymbols(): SymbolEntry[] {
  return allRegistry();
}

export function getSymbolEntry(symbol: string): SymbolEntry | undefined {
  const upper = symbol.toUpperCase();
  return allRegistry().find((e) => e.symbol.toUpperCase() === upper);
}

export function yahooResultToEntry(result: YahooSearchResult): SymbolEntry {
  return {
    symbol: result.symbol,
    companyName: result.companyName,
    yfinanceTicker: result.yfinanceTicker,
    aliases: [],
  };
}

export async function resolveSymbolEntry(query: string): Promise<SymbolEntry | null> {
  const q = query.trim();
  if (!q) return null;

  const existing = resolveSymbol(q);
  if (existing) return existing;

  const yahoo = await searchYahooNseSymbols(q, 5);
  const exact = yahoo.find((r) => r.symbol === q.toUpperCase()) ?? yahoo[0];
  if (!exact) return null;

  return registerCustomSymbol(yahooResultToEntry(exact));
}

export function resolveSymbol(query: string): SymbolEntry | null {
  const q = query.trim();
  if (!q) return null;

  const upper = q.toUpperCase();
  const registry = allRegistry();

  const exactTicker = registry.find((e) => e.symbol.toUpperCase() === upper);
  if (exactTicker) return exactTicker;

  const lower = q.toLowerCase();
  const exactName = registry.find((e) => e.companyName.toLowerCase() === lower);
  if (exactName) return exactName;

  const aliasMatch = registry.find((e) =>
    e.aliases.some((a) => a.toLowerCase() === lower)
  );
  if (aliasMatch) return aliasMatch;

  const partialName = registry.find(
    (e) =>
      e.companyName.toLowerCase().includes(lower) ||
      lower.includes(e.companyName.toLowerCase().split(" ")[0])
  );
  if (partialName) return partialName;

  let best: SymbolEntry | null = null;
  let bestScore = 0;
  for (const entry of registry) {
    const nameScore = similarity(q, entry.companyName);
    const symbolScore = similarity(q, entry.symbol);
    const score = Math.max(nameScore, symbolScore);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (best && bestScore >= 0.85) return best;
  return null;
}

export function searchSymbols(query: string, limit = 10): SymbolEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return allRegistry().slice(0, limit);

  return allRegistry()
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export async function searchSymbolsWithYahoo(
  query: string,
  limit = 10,
  options: { includeBse?: boolean } = {}
): Promise<
  Array<SymbolEntry & { source: "local" | "yahoo"; exchange: "NSE" | "BSE"; yfinanceTicker: string }>
> {
  const includeBse = options.includeBse ?? true;
  const q = query.trim();
  if (!q) {
    return searchSymbols("", limit).map((entry) => ({
      ...entry,
      source: "local" as const,
      exchange: "NSE" as const,
      yfinanceTicker: entry.yfinanceTicker,
    }));
  }

  const local = searchSymbols(q, limit).map((entry) => ({
    ...entry,
    source: "local" as const,
    exchange: "NSE" as const,
    yfinanceTicker: entry.yfinanceTicker,
  }));

  const localKeys = new Set(local.map((e) => `${e.symbol}:NSE`));
  const exchanges: Array<"NSE" | "BSE"> = includeBse ? ["NSE", "BSE"] : ["NSE"];
  const yahoo = await searchYahooIndianSymbols(q, limit, exchanges);

  const remote = yahoo
    .filter((r) => !localKeys.has(`${r.symbol}:${r.exchange}`))
    .map((r) => ({
      ...yahooResultToEntry(r),
      source: "yahoo" as const,
      exchange: r.exchange,
      yfinanceTicker: r.yfinanceTicker,
    }));

  return [...local, ...remote].slice(0, limit);
}
