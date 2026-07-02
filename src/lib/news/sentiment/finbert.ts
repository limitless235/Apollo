import { scoreRules } from "./rules";

export const FINBERT_MODEL = "Xenova/finbert";
const MAX_CHARS = 512;

export type FinbertLabel = "positive" | "negative" | "neutral";

export interface FinbertResult {
  score: number;
  label: FinbertLabel;
  confidence: number;
  probabilities: Record<FinbertLabel, number>;
}

type ClassifierOutput = Array<{ label: string; score: number }>;

let classifierPromise: Promise<
  (text: string, options?: { top_k?: number }) => Promise<ClassifierOutput>
> | null = null;

let finbertAvailable: boolean | null = null;

function normalizeLabel(raw: string): FinbertLabel {
  const label = raw.toLowerCase();
  if (label.includes("pos")) return "positive";
  if (label.includes("neg")) return "negative";
  return "neutral";
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return trimmed.slice(0, MAX_CHARS);
}

export function probabilitiesToScore(probs: Record<FinbertLabel, number>): number {
  return Math.max(-1, Math.min(1, probs.positive - probs.negative));
}

export function parseFinbertOutput(output: ClassifierOutput): FinbertResult {
  const probabilities: Record<FinbertLabel, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
  };

  for (const item of output) {
    probabilities[normalizeLabel(item.label)] = item.score;
  }

  const entries = Object.entries(probabilities) as Array<[FinbertLabel, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  const [label, confidence] = entries[0];

  return {
    score: probabilitiesToScore(probabilities),
    label,
    confidence,
    probabilities,
  };
}

async function loadClassifier() {
  const { pipeline, env } = await import("@huggingface/transformers");

  env.allowLocalModels = false;
  env.useBrowserCache = false;

  return pipeline("text-classification", FINBERT_MODEL);
}

export async function isFinbertAvailable(): Promise<boolean> {
  if (finbertAvailable != null) return finbertAvailable;
  if (process.env.SENTIMENT_MODEL === "rules") {
    finbertAvailable = false;
    return false;
  }

  try {
    if (!classifierPromise) classifierPromise = loadClassifier();
    await classifierPromise;
    finbertAvailable = true;
  } catch (error) {
    console.warn("FinBERT unavailable, falling back to rules:", error);
    finbertAvailable = false;
  }

  return finbertAvailable;
}

export async function scoreFinbert(text: string): Promise<FinbertResult | null> {
  if (!(await isFinbertAvailable())) return null;

  try {
    if (!classifierPromise) classifierPromise = loadClassifier();
    const classifier = await classifierPromise;
    const output = await classifier(truncate(text), { top_k: 3 });
    const items = Array.isArray(output) ? output : [output];
    return parseFinbertOutput(items as ClassifierOutput);
  } catch (error) {
    console.warn("FinBERT scoring failed:", error);
    finbertAvailable = false;
    classifierPromise = null;
    return null;
  }
}

/** Blend FinBERT with keyword rules — research shows modest lift from combining signals. */
export function blendScores(finbertScore: number, rulesScore: number): number {
  const finbertWeight = Number(process.env.SENTIMENT_FINBERT_WEIGHT ?? "0.65");
  const rulesWeight = 1 - finbertWeight;
  return Math.max(
    -1,
    Math.min(1, finbertScore * finbertWeight + rulesScore * rulesWeight)
  );
}

export async function scoreFinbertHybrid(text: string): Promise<{
  score: number;
  source: "finbert" | "hybrid" | "rules";
  finbert: FinbertResult | null;
  rulesScore: number;
}> {
  const rulesScore = scoreRules(text);
  const finbert = await scoreFinbert(text);

  if (!finbert) {
    return { score: rulesScore, source: "rules", finbert: null, rulesScore };
  }

  const mode = process.env.SENTIMENT_MODEL ?? "hybrid";
  if (mode === "finbert") {
    return { score: finbert.score, source: "finbert", finbert, rulesScore };
  }

  return {
    score: blendScores(finbert.score, rulesScore),
    source: "hybrid",
    finbert,
    rulesScore,
  };
}
