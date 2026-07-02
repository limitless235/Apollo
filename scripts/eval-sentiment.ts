/**
 * Compare keyword rules vs FinBERT/hybrid sentiment on sample headlines.
 * Usage: npm run eval:sentiment
 */
import { initDb, getDb } from "../src/lib/db";
import { articles } from "../src/lib/db/schema";
import {
  scoreRules,
  scoreFinbertHybrid,
  isFinbertAvailable,
  FINBERT_MODEL,
} from "../src/lib/news/sentiment";

function signAgreement(a: number, b: number): boolean {
  if (Math.abs(a) < 0.05 && Math.abs(b) < 0.05) return true;
  return Math.sign(a) === Math.sign(b);
}

async function main() {
  initDb();
  const db = getDb();
  const rows = await db.select().from(articles).orderBy(articles.publishedAt);

  const sample = rows.length > 0 ? rows.slice(-50) : getDemoHeadlines();
  const available = await isFinbertAvailable();

  console.log(`\nApollo Sentiment Evaluation`);
  console.log(`  Model: ${FINBERT_MODEL}`);
  console.log(`  FinBERT loaded: ${available ? "yes" : "no (rules only)"}`);
  console.log(`  Sample size: ${sample.length}\n`);

  if (!available) {
    console.log("FinBERT model failed to load. Check network and disk space.");
    console.log("Falling back to rules-only comparison on demo headlines.\n");
  }

  let agreement = 0;
  let avgDelta = 0;
  const flips: Array<{ title: string; rules: number; hybrid: number }> = [];

  for (const row of sample) {
    const title = "title" in row ? row.title : row;
    const summary = "summary" in row ? (row.summary ?? "") : "";
    const text = `${title} ${summary}`.trim();

    const rulesScore = scoreRules(text);
    const hybrid = await scoreFinbertHybrid(text);
    const hybridScore = hybrid.score;

    if (signAgreement(rulesScore, hybridScore)) agreement++;
    avgDelta += Math.abs(hybridScore - rulesScore);

    if (Math.sign(rulesScore) !== Math.sign(hybridScore) && Math.abs(hybridScore - rulesScore) > 0.2) {
      flips.push({
        title: title.slice(0, 72),
        rules: rulesScore,
        hybrid: hybridScore,
      });
    }
  }

  avgDelta /= sample.length;

  console.log("── Rules vs Hybrid ──\n");
  console.log(`  Sign agreement:  ${((agreement / sample.length) * 100).toFixed(1)}%`);
  console.log(`  Mean |delta|:    ${avgDelta.toFixed(3)}`);
  console.log(`  Direction flips: ${flips.length}`);

  if (flips.length > 0) {
    console.log("\n── Largest direction changes (FinBERT overrides rules) ──\n");
    for (const flip of flips.slice(0, 8)) {
      console.log(
        `  [${flip.rules >= 0 ? "+" : ""}${flip.rules.toFixed(2)} → ${flip.hybrid >= 0 ? "+" : ""}${flip.hybrid.toFixed(2)}] ${flip.title}`
      );
    }
  }

  console.log("\nRun `npm run rescore-sentiment` to update all stored articles.\n");
}

function getDemoHeadlines() {
  return [
    { title: "Reliance beats Q3 estimates with record profit growth", summary: "" },
    { title: "SEBI probe into accounting practices at major NBFC", summary: "" },
    { title: "Infosys raises guidance after strong deal wins", summary: "" },
    { title: "Tata Motors misses estimates, shares plunge on weak outlook", summary: "" },
    { title: "HDFC Bank declares interim dividend", summary: "" },
    { title: "Analyst upgrades Asian Paints to outperform", summary: "" },
  ] as Array<{ title: string; summary: string }>;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
