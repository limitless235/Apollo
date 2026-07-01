import symbolsData from "@/data/nse-symbols.json";

export interface SymbolEntry {
  symbol: string;
  companyName: string;
  yfinanceTicker: string;
  aliases: string[];
}

const registry: SymbolEntry[] = symbolsData as SymbolEntry[];

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

export function getAllSymbols(): SymbolEntry[] {
  return registry;
}

export function getSymbolEntry(symbol: string): SymbolEntry | undefined {
  return registry.find((e) => e.symbol.toUpperCase() === symbol.toUpperCase());
}

export function resolveSymbol(query: string): SymbolEntry | null {
  const q = query.trim();
  if (!q) return null;

  const upper = q.toUpperCase();

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
  if (!q) return registry.slice(0, limit);

  return registry
    .map((entry) => {
      let score = 0;
      if (entry.symbol.toLowerCase().startsWith(q)) score += 3;
      if (entry.companyName.toLowerCase().includes(q)) score += 2;
      if (entry.aliases.some((a) => a.toLowerCase().includes(q))) score += 1;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
