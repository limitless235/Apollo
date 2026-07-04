import type { SignalLabel } from "./composite";

export type TradeAction = "BUY" | "HOLD" | "SELL" | "AVOID";

export interface TradeRecommendation {
  action: TradeAction;
  confidence: "low" | "medium" | "high";
  headline: string;
  summary: string;
  reasons: string[];
  risks: string[];
  narrative: string;
}

export interface RecommendationInput {
  symbol: string;
  companyName: string;
  score: number;
  heuristicScore: number;
  learnedScore: number | null;
  label: SignalLabel;
  rank: number;
  watchlistSize: number;
  momentum5d: number;
  momentum20d: number;
  avgSentiment7d: number;
  sentimentDelta: number;
  newsCount7d: number;
  volatility20d: number;
  volumeZScore: number;
  changePercent?: number;
  backtestIc?: number;
  backtestDa?: number;
  backtestDays?: number;
  chartChange90d?: number;
  /** % above (+) / below (-) long-term average. */
  trendStrength?: number;
  /** True when most of the recent move came from a single day. */
  singleDaySpike?: boolean;
  /** True when earnings overlay is active for this symbol. */
  recentEarningsReaction?: boolean;
  postEarningsReturn3d?: number;
}

function confidenceFrom(
  action: TradeAction,
  score: number,
  backtestIc: number | undefined,
  newsCount7d: number
): "low" | "medium" | "high" {
  if (action === "HOLD") return "medium";
  let points = 0;
  if (Math.abs(score) >= 0.2) points++;
  if (backtestIc != null && backtestIc >= 0.05) points++;
  if (newsCount7d >= 3) points++;
  if (points >= 2) return "high";
  if (points === 1) return "medium";
  return "low";
}

export function generateTradeRecommendation(input: RecommendationInput): TradeRecommendation {
  const {
    symbol,
    companyName,
    score,
    heuristicScore,
    learnedScore,
    label,
    rank,
    watchlistSize,
    momentum5d,
    momentum20d,
    avgSentiment7d,
    sentimentDelta,
    newsCount7d,
    volatility20d,
    volumeZScore,
    changePercent = 0,
    backtestIc,
    backtestDa,
    backtestDays,
    chartChange90d,
    trendStrength = 0,
    singleDaySpike = false,
    recentEarningsReaction = false,
    postEarningsReturn3d = 0,
  } = input;

  const reasons: string[] = [];
  const risks: string[] = [];
  let action: TradeAction = "HOLD";

  const topTier = rank <= Math.max(3, Math.ceil(watchlistSize * 0.1));
  const parabolic = momentum20d >= 35 || (chartChange90d != null && chartChange90d >= 80);
  const belowTrend = trendStrength <= -3;
  const weakNews = newsCount7d === 0;
  const strongNews = newsCount7d >= 5;
  const bullishMomentum = momentum5d > 0 && momentum20d > 0;
  const bearishMomentum = momentum5d < 0 && momentum20d < 0;
  const goodBacktest = backtestIc != null && backtestIc >= 0.05 && (backtestDa ?? 0) >= 0.52;

  if (label === "Strong Bearish" || score <= -0.2) {
    action = "SELL";
    reasons.push(`Signal is ${label.toLowerCase()} (score ${score.toFixed(2)})`);
    if (bearishMomentum) reasons.push("Price momentum is negative on 5d and 20d");
    if (avgSentiment7d <= -0.15) reasons.push("Recent news sentiment is bearish");
  } else if (label === "Bearish" || score <= -0.08) {
    action = weakNews && !bearishMomentum ? "HOLD" : "SELL";
    reasons.push(`Bearish composite signal (${score.toFixed(2)})`);
    if (action === "HOLD") reasons.push("Momentum not fully broken — downgrade rather than panic sell");
  } else if (parabolic && score < 0.35) {
    action = "AVOID";
    risks.push(
      momentum20d >= 35
        ? `Already up ${momentum20d.toFixed(0)}% in 20 days — extended move`
        : `Chart up ${chartChange90d?.toFixed(0)}% over ~90 days — chase risk`
    );
    if (weakNews) risks.push("No recent news in Apollo — move may be price-only");
    reasons.push("Rank and momentum look hot, but entry here is statistically risky");
    if (topTier) reasons.push(`Still ranked #${rank} on your watchlist for attention`);
  } else if (
    belowTrend &&
    bullishMomentum &&
    (label === "Strong Bullish" || label === "Bullish" || score >= 0.08)
  ) {
    action = "HOLD";
    reasons.push(
      `Momentum is up (+${momentum20d.toFixed(1)}% 20d) but price is still ${Math.abs(trendStrength).toFixed(0)}% below its long-term average`
    );
    reasons.push("Looks like a bounce within a downtrend — wait for the long-term trend to turn");
    risks.push(
      `Below long-term trend (${trendStrength.toFixed(0)}%) — recovery rallies often fade`
    );
    if (singleDaySpike) risks.push("Most of the recent pop came in one day — unconfirmed");
  } else if (
    (label === "Strong Bullish" || (label === "Bullish" && topTier && score >= 0.12)) &&
    bullishMomentum &&
    !parabolic &&
    !belowTrend
  ) {
    action = "BUY";
    reasons.push(`${label} signal (score ${score.toFixed(2)}, rank #${rank})`);
    if (bullishMomentum) {
      reasons.push(`Momentum +${momentum5d.toFixed(1)}% (5d) / +${momentum20d.toFixed(1)}% (20d)`);
    }
    if (avgSentiment7d >= 0.1) reasons.push(`News sentiment supportive (${avgSentiment7d.toFixed(2)})`);
    else if (strongNews) reasons.push("Active news flow — review headlines before sizing");
    if (goodBacktest) {
      reasons.push(
        `Historical signal quality decent (IC ${backtestIc!.toFixed(3)}, DA ${((backtestDa ?? 0) * 100).toFixed(0)}% over ${backtestDays ?? "?"} days)`
      );
    }
    if (learnedScore != null && learnedScore > 0) {
      reasons.push(`ML ranker also positive (+${learnedScore.toFixed(2)})`);
    }
  } else if (label === "Bullish" || score >= 0.08) {
    action = parabolic || weakNews ? "HOLD" : topTier ? "BUY" : "HOLD";
    reasons.push(`Bullish but not extreme (score ${score.toFixed(2)})`);
    if (topTier) reasons.push(`Top ${rank} of ${watchlistSize} on your watchlist`);
    if (action === "HOLD" && parabolic) risks.push("Strong recent run — prefer hold/trim over new buys");
    if (action === "HOLD" && weakNews) risks.push("Zero articles in last 7d — confirm story elsewhere");
  } else {
    action = "HOLD";
    reasons.push(`Neutral signal (${score.toFixed(2)}) — no clear edge`);
  }

  if (volatility20d >= 40) {
    risks.push(`High volatility (${volatility20d.toFixed(0)}% annualized) — size smaller`);
  }
  if (sentimentDelta <= -0.2) {
    risks.push("Sentiment deteriorating vs prior week");
  }
  if (sentimentDelta >= 0.2 && avgSentiment7d > 0) {
    reasons.push("Sentiment improving week-over-week");
  }
  if (volumeZScore >= 1.5 && momentum5d < 0) {
    risks.push("Heavy volume on down move — distribution risk");
  }
  if (changePercent <= -3) {
    risks.push(`Down ${Math.abs(changePercent).toFixed(1)}% today — wait for stabilization before adding`);
  }
  if (singleDaySpike && action === "BUY") {
    risks.push("Recent move is largely a single-day spike — prefer confirmation before sizing up");
  }
  if (trendStrength >= 5 && (action === "BUY" || action === "HOLD")) {
    reasons.push(`Trading ${trendStrength.toFixed(0)}% above its long-term average (uptrend intact)`);
  }
  if (recentEarningsReaction) {
    const direction =
      postEarningsReturn3d >= 1
        ? "positive"
        : postEarningsReturn3d <= -1
          ? "negative"
          : "mixed";
    reasons.push(
      `Recent earnings reaction (${direction}, ${postEarningsReturn3d >= 0 ? "+" : ""}${postEarningsReturn3d.toFixed(1)}% 3d post-print) nudged the score`
    );
  }

  const confidence = confidenceFrom(action, score, backtestIc, newsCount7d);

  const headline = `${action} — ${companyName} (${symbol})`;
  const summary =
    action === "BUY"
      ? "Signal, momentum, and rank support a personal entry — verify news and size for volatility."
      : action === "SELL"
        ? "Signal and momentum argue for reducing or exiting a personal position."
        : action === "AVOID"
          ? "Interesting for the watchlist, but poor risk/reward for a new buy after a big run."
          : "No strong edge — hold existing size or wait for clearer confirmation.";

  const narrative = buildNarrative({
    symbol,
    companyName,
    action,
    confidence,
    score,
    heuristicScore,
    learnedScore,
    rank,
    label,
    reasons,
    risks,
    backtestIc,
    backtestDa,
  });

  return { action, confidence, headline, summary, reasons, risks, narrative };
}

function buildNarrative(params: {
  symbol: string;
  companyName: string;
  action: TradeAction;
  confidence: "low" | "medium" | "high";
  score: number;
  heuristicScore: number;
  learnedScore: number | null;
  rank: number;
  label: SignalLabel;
  reasons: string[];
  risks: string[];
  backtestIc?: number;
  backtestDa?: number;
}): string {
  const ml =
    params.learnedScore != null
      ? ` ML layer ${params.learnedScore >= 0 ? "+" : ""}${params.learnedScore.toFixed(2)}.`
      : "";
  const backtest =
    params.backtestIc != null
      ? ` Over the past year this symbol's signal had IC ${params.backtestIc.toFixed(3)} (DA ${((params.backtestDa ?? 0) * 100).toFixed(0)}%) — historical only.`
      : "";

  const actionText =
    params.action === "BUY"
      ? "I'd lean toward buying a starter position"
      : params.action === "SELL"
        ? "I'd lean toward selling or trimming"
        : params.action === "AVOID"
          ? "I'd avoid opening a new position here"
          : "I'd hold and watch";

  return [
    `${params.companyName} (${params.symbol}) is rank #${params.rank} with a ${params.label.toLowerCase()} blended score of ${params.score.toFixed(2)} (heuristic ${params.heuristicScore.toFixed(2)}.${ml}).`,
    `${actionText} (${params.confidence} confidence).`,
    params.reasons.length > 0 ? `Why: ${params.reasons.slice(0, 3).join("; ")}.` : "",
    params.risks.length > 0 ? `Risks: ${params.risks.slice(0, 3).join("; ")}.` : "",
    backtest,
    "Personal use only — your call on sizing and timing.",
  ]
    .filter(Boolean)
    .join(" ");
}
