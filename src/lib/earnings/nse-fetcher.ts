import type { EarningsEventRecord } from "./types";

const NSE_HOME = "https://www.nseindia.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EARNINGS_SUBJECT_PATTERNS = [
  /financial\s+result/i,
  /quarterly\s+result/i,
  /unaudited\s+financial/i,
  /outcome\s+of\s+board\s+meeting/i,
  /board\s+meeting.*result/i,
  /earnings/i,
  /q\d\s+fy\d/i,
];

interface NseAnnouncement {
  symbol?: string;
  sm_symbol?: string;
  desc?: string;
  subject?: string;
  an_dt?: string;
  sort_date?: string;
  dt?: string;
}

function formatNseDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseNseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // dd-mm-yyyy or dd-MMM-yyyy
  const dmy = trimmed.match(/^(\d{1,2})-(\d{1,2}|[A-Za-z]{3})-(\d{4})/);
  if (dmy) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const dd = dmy[1].padStart(2, "0");
    const mm = months[dmy[2]] ?? dmy[2].padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function isEarningsAnnouncement(item: NseAnnouncement): boolean {
  const text = `${item.desc ?? ""} ${item.subject ?? ""}`;
  return EARNINGS_SUBJECT_PATTERNS.some((re) => re.test(text));
}

async function nseFetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${NSE_HOME}${path}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      Referer: `${NSE_HOME}/companies-listing/corporate-filings-announcements`,
    },
  });
  if (!res.ok) {
    console.warn(`NSE API ${path} → ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

/** Warm NSE session cookies (required for API access). */
async function warmNseSession(): Promise<void> {
  await fetch(NSE_HOME, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
}

export async function fetchNseEarningsAnnouncements(
  fromDate: Date,
  toDate: Date,
  allowedSymbols: Set<string>
): Promise<EarningsEventRecord[]> {
  await warmNseSession();

  const path =
    `/api/corporate-announcements?index=equities` +
    `&from_date=${formatNseDate(fromDate)}&to_date=${formatNseDate(toDate)}`;

  const data = await nseFetchJson<NseAnnouncement[] | { data?: NseAnnouncement[] }>(path);
  const items = Array.isArray(data) ? data : data?.data ?? [];

  const results: EarningsEventRecord[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!isEarningsAnnouncement(item)) continue;

    const symbol = (item.symbol ?? item.sm_symbol ?? "").toUpperCase().trim();
    if (!symbol || !allowedSymbols.has(symbol)) continue;

    const eventDate = parseNseDate(item.an_dt ?? item.sort_date ?? item.dt);
    if (!eventDate) continue;

    const key = `${symbol}|${eventDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      symbol,
      eventDate,
      actualEps: null,
      estimateEps: null,
      source: "nse_announcement",
    });
  }

  return results;
}

/** Fallback: yfinance earnings dates when NSE returns nothing for a symbol. */
export async function fetchYfinanceEarningsDates(
  symbol: string,
  yahooTicker: string
): Promise<EarningsEventRecord[]> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
      `?modules=calendarEvents`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          calendarEvents?: {
            earnings?: {
              earningsDate?: Array<{ raw?: number; fmt?: string }>;
            };
          };
        }>;
      };
    };

    const dates =
      json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? [];
    const records: EarningsEventRecord[] = [];

    for (const d of dates) {
      const eventDate = d.fmt
        ? parseNseDate(d.fmt)
        : d.raw
          ? new Date(d.raw * 1000).toISOString().slice(0, 10)
          : null;
      if (!eventDate) continue;
      records.push({
        symbol: symbol.toUpperCase(),
        eventDate,
        actualEps: null,
        estimateEps: null,
        source: "yfinance_fallback",
      });
    }

    return records;
  } catch {
    return [];
  }
}
