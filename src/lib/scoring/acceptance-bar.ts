import { countSignFlips } from "./walk-forward-logging";
import type { IcSignificance } from "./ic-stats";

export interface AcceptanceBarResult {
  pass: boolean;
  reasons: string[];
  tStatPass: boolean;
  signFlipPass: boolean;
  signFlips: number;
  maxAllowedSignFlips: number;
  significance: IcSignificance;
}

/** Stricter bar: |t|>2 and at most 1 sign flip across folds. */
export function evaluateAcceptanceBar(
  foldMeanIcs: number[],
  aggregate: IcSignificance,
  options: { maxSignFlips?: number; minTStat?: number } = {}
): AcceptanceBarResult {
  const maxAllowedSignFlips = options.maxSignFlips ?? 1;
  const minTStat = options.minTStat ?? 2;

  const signFlips = countSignFlips(foldMeanIcs);
  const tStatPass = Math.abs(aggregate.tStat) > minTStat;
  const signFlipPass = signFlips <= maxAllowedSignFlips;

  const reasons: string[] = [];
  if (!tStatPass) {
    reasons.push(`|t-stat|=${Math.abs(aggregate.tStat).toFixed(2)} ≤ ${minTStat}`);
  }
  if (!signFlipPass) {
    reasons.push(`sign flips=${signFlips} > ${maxAllowedSignFlips}`);
  }

  return {
    pass: tStatPass && signFlipPass,
    reasons,
    tStatPass,
    signFlipPass,
    signFlips,
    maxAllowedSignFlips,
    significance: aggregate,
  };
}
