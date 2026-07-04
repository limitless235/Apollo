/** Cap values at the lower/upper percentile (inclusive). */
export function winsorize(
  values: number[],
  lowerPct = 0.05,
  upperPct = 0.95
): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * lowerPct)] ?? sorted[0];
  const hi = sorted[Math.floor(sorted.length * upperPct)] ?? sorted[sorted.length - 1];
  return values.map((v) => Math.min(Math.max(v, lo), hi));
}
