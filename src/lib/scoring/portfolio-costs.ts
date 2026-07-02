/** NSE-style transaction cost assumptions for portfolio backtests. */
export const DEFAULT_TX_COST_BPS = 10; // 0.10% per side (FinTSB default)

export function getTxCostPct(): number {
  const raw = Number(process.env.BACKTEST_TX_COST_PCT ?? "0.1");
  return Number.isNaN(raw) ? 0.1 : Math.max(0, raw);
}

/** Daily turnover estimate for full top-K rebalance (fraction of portfolio traded). */
export function estimateDailyTurnover(topK: number, universeSize: number): number {
  if (universeSize <= 0) return 1;
  // Equal-weight top-K: roughly replace entire book when ranks shuffle fully
  return Math.min(2, (2 * topK) / universeSize + 0.5);
}

export function applyTransactionCost(
  grossReturnPct: number,
  turnover: number,
  txCostPct = getTxCostPct()
): number {
  const cost = turnover * txCostPct;
  return grossReturnPct - cost;
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
