import { toRankScore } from "./cross-sectional";

export type ScoringMode = "blend" | "ml_only" | "heuristic_only";

export function getScoringMode(): ScoringMode {
  const raw = (process.env.SCORING_MODE ?? "blend").toLowerCase();
  if (raw === "ml_only" || raw === "heuristic_only" || raw === "blend") return raw;
  return "blend";
}

/** ML weight from walk-forward IC — only positive-IC components get weight. */
export function computeBlendWeight(heuristicIC: number, mlIC: number): number {
  const hIC = Math.max(heuristicIC, 0);
  const mIC = Math.max(mlIC, 0);
  if (hIC + mIC === 0) return 1;
  return mIC / (hIC + mIC);
}

export function blendRankScores(
  heuristicScores: number[],
  learnedScores: (number | null)[],
  mlWeight: number,
  mode: ScoringMode = getScoringMode()
): number[] {
  const hRanks = toRankScore(heuristicScores);

  const validLearned = learnedScores.map((s) => s ?? 0);
  const hasLearned = learnedScores.some((s) => s != null);
  const mRanks = hasLearned ? toRankScore(validLearned) : hRanks.map(() => 0);

  const hWeight = 1 - mlWeight;

  return heuristicScores.map((_, i) => {
    if (mode === "heuristic_only") return hRanks[i];
    if (mode === "ml_only") {
      return learnedScores[i] != null ? mRanks[i] : hRanks[i];
    }
    if (learnedScores[i] == null) return hRanks[i];
    return hWeight * hRanks[i] + mlWeight * mRanks[i];
  });
}
