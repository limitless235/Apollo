import { sentimentLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function SentimentPill({ score }: { score: number }) {
  const label = sentimentLabel(score);
  return (
    <span
      className={cn(
        "sentiment-pill",
        label === "bull" && "sentiment-pill-bull",
        label === "bear" && "sentiment-pill-bear",
        label === "neutral" && "sentiment-pill-neutral"
      )}
    >
      {label === "bull" ? "Bullish" : label === "bear" ? "Bearish" : "Neutral"}
    </span>
  );
}
