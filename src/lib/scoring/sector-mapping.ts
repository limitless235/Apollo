import fs from "fs";
import path from "path";

interface SectorMappingFile {
  marketIndex: { id: string; yahooTicker: string; label: string };
  sectors: Record<string, { label: string; yahooTicker: string }>;
  symbols: Record<string, string>;
}

const MAPPING_PATH = path.join(process.cwd(), "data", "sector-mapping.json");

let cached: SectorMappingFile | null = null;

function loadMapping(): SectorMappingFile {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf-8")) as SectorMappingFile;
  return cached;
}

export function getMarketIndexTicker(): string {
  return loadMapping().marketIndex.yahooTicker;
}

export function getSectorId(symbol: string): string | null {
  return loadMapping().symbols[symbol.toUpperCase()] ?? null;
}

export function getSectorYahooTicker(sectorId: string): string | null {
  return loadMapping().sectors[sectorId]?.yahooTicker ?? null;
}

export function getSectorYahooTickerForSymbol(symbol: string): string | null {
  const sectorId = getSectorId(symbol);
  if (!sectorId) return null;
  return getSectorYahooTicker(sectorId);
}

export function getAllSectorIds(): string[] {
  return Object.keys(loadMapping().sectors);
}
