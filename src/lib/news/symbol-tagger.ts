import { getAllSymbols } from "@/lib/symbols/registry";

export function tagSymbolsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const entry of getAllSymbols()) {
    if (lower.includes(entry.symbol.toLowerCase())) {
      found.add(entry.symbol);
      continue;
    }
    const nameWords = entry.companyName.toLowerCase().split(/\s+/);
    const significantWords = nameWords.filter((w) => w.length > 3);
    if (significantWords.length >= 2) {
      const firstTwo = significantWords.slice(0, 2).join(" ");
      if (lower.includes(firstTwo)) {
        found.add(entry.symbol);
        continue;
      }
    }
    for (const alias of entry.aliases) {
      if (alias.length > 2 && lower.includes(alias.toLowerCase())) {
        found.add(entry.symbol);
        break;
      }
    }
  }

  return Array.from(found);
}
