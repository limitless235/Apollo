/** NSE delivery-equity transaction cost assumptions (bps). Verify rates periodically. */
export const NSE_COST_MODEL = {
  brokerageBps: 3,
  sttSellBps: 25,
  impactCostBps: 10,
  stampDutyBps: 1.5,
} as const;

export type CostModel = typeof NSE_COST_MODEL;

export function oneWayCostBps(side: "buy" | "sell", model: CostModel = NSE_COST_MODEL): number {
  const base = model.brokerageBps + model.impactCostBps;
  return side === "sell" ? base + model.sttSellBps : base + model.stampDutyBps;
}

/** Full round-trip cost in basis points (buy + sell). */
export function roundTripCostBps(model: CostModel = NSE_COST_MODEL): number {
  return oneWayCostBps("buy", model) + oneWayCostBps("sell", model);
}

/** Round-trip cost as a percentage (e.g. 0.695 for ~69.5 bps). */
export function getRoundTripCostPct(model: CostModel = NSE_COST_MODEL): number {
  return roundTripCostBps(model) / 100;
}

/** @deprecated use getRoundTripCostPct — kept for legacy env override */
export const DEFAULT_TX_COST_BPS = 10;

export function getTxCostPct(): number {
  const env = process.env.BACKTEST_TX_COST_PCT;
  if (env != null && env !== "") {
    const raw = Number(env);
    if (!Number.isNaN(raw)) return Math.max(0, raw);
  }
  return getRoundTripCostPct();
}

/**
 * Cost of rebalancing equal-weight top-K portfolio (% of portfolio value).
 * Charges one-way cost on each exit and each entry.
 */
export function rebalanceCostPct(
  prevSymbols: string[],
  nextSymbols: string[],
  model: CostModel = NSE_COST_MODEL
): number {
  const k = nextSymbols.length;
  if (k === 0) return 0;

  const prev = new Set(prevSymbols);
  const next = new Set(nextSymbols);
  let exits = 0;
  let entries = 0;
  for (const s of prev) if (!next.has(s)) exits++;
  for (const s of next) if (!prev.has(s)) entries++;

  const buyPct = oneWayCostBps("buy", model) / 10000;
  const sellPct = oneWayCostBps("sell", model) / 10000;
  return ((exits * sellPct + entries * buyPct) / k) * 100;
}

/** @deprecated rough turnover estimate — prefer rebalanceCostPct with actual holdings */
export function estimateDailyTurnover(topK: number, universeSize: number): number {
  if (universeSize <= 0) return 1;
  return Math.min(2, (2 * topK) / universeSize + 0.5);
}

export function applyTransactionCost(
  grossReturnPct: number,
  turnover: number,
  txCostPct = getTxCostPct()
): number {
  return grossReturnPct - turnover * txCostPct;
}

export function portfolioStats(returns: number[]) {
  if (returns.length === 0) {
    return {
      days: 0,
      avgDailyReturn: 0,
      cumulativeReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
    };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  const cumulative = returns.reduce((acc, r) => acc * (1 + r / 100), 1);

  let peak = 1;
  let maxDrawdown = 0;
  let equity = 1;
  for (const r of returns) {
    equity *= 1 + r / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity - peak) / peak);
  }

  return {
    days: returns.length,
    avgDailyReturn: mean,
    cumulativeReturn: (cumulative - 1) * 100,
    sharpe,
    maxDrawdown: maxDrawdown * 100,
  };
}
