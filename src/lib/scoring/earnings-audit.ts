import type { TrainingSample } from "./train-ridge";
import { prepareCrossSectionalSamples } from "./cross-sectional";
import { trainEndWithLabelPurge } from "./walk-forward-logging";
import { dailyIcSeries, icSignificance } from "./ic-stats";
import { dailyIcStd } from "./walk-forward-logging";
import { winsorize } from "./winsorize";
import { evaluateAcceptanceBar } from "./acceptance-bar";
import type { RawFeatures } from "./features";

const FORWARD_DAYS = 5;

export interface NearEarningsRow {
  date: string;
  symbol: string;
  postEarningsReturn3d: number;
  forwardReturn5d: number;
  fold: number;
}

export interface FoldIcComparison {
  fold: number;
  testStart: string;
  testEnd: string;
  nQualifyingDays: number;
  nRows: number;
  meanICRaw: number;
  meanICWinsorized: number;
  dailyIcStdRaw: number;
  dailyIcStdWinsorized: number;
}

export interface OutlierAuditResult {
  fold4Rows: NearEarningsRow[];
  fold4Top10ByAbsReturn: NearEarningsRow[];
  fold4Qualitative: {
    dateRange: { start: string; end: string };
    uniqueSymbols: number;
    symbolDateList: Array<{ date: string; symbol: string; forwardReturn5d: number }>;
    note: string;
  };
  icByFold: FoldIcComparison[];
  pooledRaw: ReturnType<typeof icSignificance>;
  pooledWinsorized: ReturnType<typeof icSignificance>;
  acceptanceRaw: ReturnType<typeof evaluateAcceptanceBar>;
  acceptanceWinsorized: ReturnType<typeof evaluateAcceptanceBar>;
  interpretation: string;
  overlayIcBasis: "raw" | "winsorized";
}

function nearEarningsFilter(f: RawFeatures): boolean {
  return (
    f.hasRecentEarnings === 1 &&
    f.earningsDataAvailable === 1 &&
    f.postEarningsReturn3d !== 0
  );
}

function collectFoldNearEarningsRows(
  samples: TrainingSample[],
  fold: number,
  testStart: string,
  testEnd: string
): NearEarningsRow[] {
  const rows: NearEarningsRow[] = [];
  for (const s of samples) {
    if (s.date < testStart || s.date > testEnd) continue;
    if (!nearEarningsFilter(s.features)) continue;
    rows.push({
      date: s.date,
      symbol: s.symbol,
      postEarningsReturn3d: s.features.postEarningsReturn3d,
      forwardReturn5d: s.nextReturn,
      fold,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

function dailyIcFromRows(
  rows: NearEarningsRow[],
  useWinsorizedReturns: boolean
): number[] {
  const returns = rows.map((r) => r.forwardReturn5d);
  const winsorized = winsorize(returns);

  const dated: Array<{ date: string; predicted: number; actual: number }> = [];
  rows.forEach((r, i) => {
    dated.push({
      date: r.date,
      predicted: r.postEarningsReturn3d,
      actual: useWinsorizedReturns ? winsorized[i]! : r.forwardReturn5d,
    });
  });

  return dailyIcSeries(dated);
}

export function runPostEarningsOutlierAudit(
  samples: TrainingSample[],
  options: { targetFold?: number } = {}
): OutlierAuditResult | null {
  const prepared = prepareCrossSectionalSamples(samples, { targetType: "rank" });
  if (prepared.length < 200) return null;

  const uniqueDates = [...new Set(prepared.map((s) => s.date))].sort();
  const nFolds = 6;
  const testDays = 60;
  const minTrainDays = 120;
  const totalTestSpan = nFolds * testDays;
  const startIdx = Math.max(minTrainDays, uniqueDates.length - totalTestSpan);

  const icByFold: FoldIcComparison[] = [];
  const allDailyRaw: number[] = [];
  const allDailyWin: number[] = [];
  let fold4Rows: NearEarningsRow[] = [];

  for (let f = 0; f < nFolds; f++) {
    const testStartIdx = startIdx + f * testDays;
    const testEndIdx = Math.min(testStartIdx + testDays, uniqueDates.length);
    if (testStartIdx >= uniqueDates.length) break;

    const purge = trainEndWithLabelPurge(uniqueDates, testStartIdx, FORWARD_DAYS);
    if (!purge) continue;

    const testStart = uniqueDates[testStartIdx];
    const testEnd = uniqueDates[testEndIdx - 1];
    const foldNum = f + 1;

    const rows = collectFoldNearEarningsRows(samples, foldNum, testStart, testEnd);
    if (foldNum === (options.targetFold ?? 4)) {
      fold4Rows = rows;
    }

    const dailyRaw = dailyIcFromRows(rows, false);
    const dailyWin = dailyIcFromRows(rows, true);
    allDailyRaw.push(...dailyRaw);
    allDailyWin.push(...dailyWin);

    const qualDays = new Set(rows.map((r) => r.date)).size;
    icByFold.push({
      fold: foldNum,
      testStart,
      testEnd,
      nQualifyingDays: qualDays,
      nRows: rows.length,
      meanICRaw: dailyRaw.length ? dailyRaw.reduce((a, b) => a + b, 0) / dailyRaw.length : 0,
      meanICWinsorized: dailyWin.length
        ? dailyWin.reduce((a, b) => a + b, 0) / dailyWin.length
        : 0,
      dailyIcStdRaw: dailyIcStd(dailyRaw),
      dailyIcStdWinsorized: dailyIcStd(dailyWin),
    });
  }

  if (icByFold.length === 0) return null;

  const pooledRaw = icSignificance(allDailyRaw);
  const pooledWinsorized = icSignificance(allDailyWin);
  const foldMeanRaw = icByFold.map((f) => f.meanICRaw);
  const foldMeanWin = icByFold.map((f) => f.meanICWinsorized);

  const acceptanceRaw = evaluateAcceptanceBar(foldMeanRaw, pooledRaw);
  const acceptanceWinsorized = evaluateAcceptanceBar(foldMeanWin, pooledWinsorized);

  const fold4Ic = icByFold.find((f) => f.fold === 4);
  const fold4Drop =
    fold4Ic != null ? fold4Ic.meanICRaw - fold4Ic.meanICWinsorized : 0;

  let overlayIcBasis: "raw" | "winsorized" = "raw";
  let interpretation: string;

  if (fold4Drop > 0.15) {
    overlayIcBasis = "winsorized";
    interpretation =
      `Fold 4 IC dropped sharply after winsorizing (+${fold4Ic?.meanICRaw.toFixed(3)} → +${fold4Ic?.meanICWinsorized.toFixed(3)}), ` +
      `suggesting outlier-driven magnitude. Use winsorized pooled IC (t=${pooledWinsorized.tStat.toFixed(2)}) for overlay sizing.`;
  } else if (Math.abs(fold4Drop) <= 0.15) {
    interpretation =
      `Fold 4 IC stable after winsorizing (+${fold4Ic?.meanICRaw.toFixed(3)} → +${fold4Ic?.meanICWinsorized.toFixed(3)}). ` +
      `Effect appears broad-based across qualifying days; raw pooled IC (t=${pooledRaw.tStat.toFixed(2)}) is trustworthy for overlay design.`;
  } else {
    interpretation =
      `Fold 4 winsorized IC higher than raw — rank IC already dampens extremes. Prefer winsorized series (t=${pooledWinsorized.tStat.toFixed(2)}) for conservative overlay calibration.`;
    overlayIcBasis = "winsorized";
  }

  if (Math.abs(pooledWinsorized.tStat) < 2 && Math.abs(pooledRaw.tStat) >= 2) {
    interpretation +=
      " Winsorized pooled t-stat falls below 2 — treat signal as directionally real but weaker; use conservative shrinkage in overlay.";
    overlayIcBasis = "winsorized";
  }

  const fold4Top10 = [...fold4Rows]
    .sort((a, b) => Math.abs(b.forwardReturn5d) - Math.abs(a.forwardReturn5d))
    .slice(0, 10);

  const symbolDates = fold4Rows.map((r) => ({
    date: r.date,
    symbol: r.symbol,
    forwardReturn5d: r.forwardReturn5d,
  }));

  const uniqueSymbols = new Set(fold4Rows.map((r) => r.symbol)).size;
  const qualitativeNote =
    `Window ${fold4Rows[0]?.date ?? "?"} – ${fold4Rows[fold4Rows.length - 1]?.date ?? "?"}: ` +
    `${uniqueSymbols} symbols, ${fold4Rows.length} row-days. ` +
    `Dec–Mar period includes Q3 FY26 results season for many NSE names; inspect top-|return| rows for single-name dominance vs broad seasonality.`;

  return {
    fold4Rows,
    fold4Top10ByAbsReturn: fold4Top10,
    fold4Qualitative: {
      dateRange: {
        start: fold4Rows[0]?.date ?? "",
        end: fold4Rows[fold4Rows.length - 1]?.date ?? "",
      },
      uniqueSymbols,
      symbolDateList: symbolDates,
      note: qualitativeNote,
    },
    icByFold,
    pooledRaw,
    pooledWinsorized,
    acceptanceRaw,
    acceptanceWinsorized,
    interpretation,
    overlayIcBasis,
  };
}

export function printOutlierAudit(audit: OutlierAuditResult): void {
  console.log("\n── Part 1: Fold 4 outlier audit ──\n");
  console.log(`Date range: ${audit.fold4Qualitative.dateRange.start} → ${audit.fold4Qualitative.dateRange.end}`);
  console.log(`Rows: ${audit.fold4Rows.length} · Symbols: ${audit.fold4Qualitative.uniqueSymbols}`);
  console.log(audit.fold4Qualitative.note);

  console.log("\nTop 10 by |forwardReturn5d| (fold 4 near-earnings):");
  console.log("date       | symbol     | postEarningsReturn3d | forwardReturn5d");
  console.log("-".repeat(65));
  for (const r of audit.fold4Top10ByAbsReturn) {
    console.log(
      `${r.date} | ${r.symbol.padEnd(10)} | ${r.postEarningsReturn3d.toFixed(2).padStart(18)} | ${r.forwardReturn5d.toFixed(2)}`
    );
  }

  console.log("\nIC by fold (raw vs winsorized forwardReturn5d):");
  console.log("fold | qual_days | n_rows | IC_raw   | IC_win   | Δ");
  console.log("-".repeat(55));
  for (const f of audit.icByFold) {
    const delta = f.meanICRaw - f.meanICWinsorized;
    console.log(
      `${String(f.fold).padStart(4)} | ${String(f.nQualifyingDays).padStart(9)} | ${String(f.nRows).padStart(6)} | ${f.meanICRaw >= 0 ? "+" : ""}${f.meanICRaw.toFixed(4)} | ${f.meanICWinsorized >= 0 ? "+" : ""}${f.meanICWinsorized.toFixed(4)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`
    );
  }
  console.log("-".repeat(55));
  console.log(
    `ALL | ${String(audit.pooledRaw.nDays).padStart(9)} |        | ${audit.pooledRaw.meanIC >= 0 ? "+" : ""}${audit.pooledRaw.meanIC.toFixed(4)} (t=${audit.pooledRaw.tStat.toFixed(2)}) | ${audit.pooledWinsorized.meanIC >= 0 ? "+" : ""}${audit.pooledWinsorized.meanIC.toFixed(4)} (t=${audit.pooledWinsorized.tStat.toFixed(2)})`
  );
  console.log(`\nInterpretation: ${audit.interpretation}`);
  console.log(`Overlay IC basis: ${audit.overlayIcBasis}\n`);
}
