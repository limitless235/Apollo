const BULLISH = [
  "beat estimates",
  "record profit",
  "record revenue",
  "upgrade",
  "upgraded",
  "outperform",
  "buy rating",
  "strong growth",
  "surge",
  "rally",
  "all-time high",
  "dividend",
  "expansion",
  "order win",
  "bullish",
  "positive outlook",
  "raises guidance",
  "profit jumps",
  "revenue growth",
];

const BEARISH = [
  "downgrade",
  "downgraded",
  "underperform",
  "sell rating",
  "fraud",
  "default",
  "probe",
  "investigation",
  "sebi probe",
  "loss widens",
  "miss estimates",
  "misses estimates",
  "decline",
  "plunge",
  "crash",
  "layoffs",
  "debt concern",
  "bearish",
  "negative outlook",
  "cuts guidance",
  "profit falls",
  "revenue decline",
  "scam",
  "penalty",
];

export function scoreRules(text: string): number {
  const lower = text.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  for (const phrase of BULLISH) {
    if (lower.includes(phrase)) bullish++;
  }
  for (const phrase of BEARISH) {
    if (lower.includes(phrase)) bearish++;
  }

  const total = bullish + bearish;
  if (total === 0) return 0;
  const score = (bullish - bearish) / total;
  return Math.max(-1, Math.min(1, score));
}
