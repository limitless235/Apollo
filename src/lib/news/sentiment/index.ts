import { scoreRules } from "./rules";
import { scoreFinbertHybrid, type FinbertResult } from "./finbert";

export type SentimentSource = "rules" | "finbert" | "hybrid";

export interface SentimentResult {
  score: number;
  source: SentimentSource;
  label?: FinbertResult["label"];
  confidence?: number;
}

export { scoreRules } from "./rules";
export {
  scoreFinbert,
  scoreFinbertHybrid,
  isFinbertAvailable,
  FINBERT_MODEL,
  type FinbertResult,
} from "./finbert";

export function isBullish(score: number): boolean {
  return score >= 0.2;
}

export function isBearish(score: number): boolean {
  return score <= -0.2;
}

function resolveMode(): SentimentSource | "auto" {
  const mode = process.env.SENTIMENT_MODEL?.toLowerCase();
  if (mode === "rules" || mode === "finbert" || mode === "hybrid") return mode;
  return "auto";
}

/** Score a single headline synchronously with keyword rules only. */
export function scoreSentiment(text: string): number {
  return scoreRules(text);
}

/** Score with configured model (rules / finbert / hybrid). */
export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const mode = resolveMode();

  if (mode === "rules") {
    return { score: scoreRules(text), source: "rules" };
  }

  const result = await scoreFinbertHybrid(text);
  return {
    score: result.score,
    source: result.source,
    label: result.finbert?.label,
    confidence: result.finbert?.confidence,
  };
}

/** Batch score for ingest — loads FinBERT once, processes sequentially. */
export async function analyzeSentimentBatch(
  texts: string[]
): Promise<SentimentResult[]> {
  const mode = resolveMode();
  if (mode === "rules") {
    return texts.map((text) => ({ score: scoreRules(text), source: "rules" as const }));
  }

  const results: SentimentResult[] = [];
  for (const text of texts) {
    results.push(await analyzeSentiment(text));
  }
  return results;
}

export function getSentimentModelLabel(source: SentimentSource): string {
  switch (source) {
    case "finbert":
      return "FinBERT";
    case "hybrid":
      return "Hybrid";
    default:
      return "Rules";
  }
}
