import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function sentimentLabel(score: number): "bull" | "bear" | "neutral" {
  if (score >= 0.2) return "bull";
  if (score <= -0.2) return "bear";
  return "neutral";
}

export function sentimentColor(score: number): string {
  const label = sentimentLabel(score);
  if (label === "bull") return "hsl(var(--bull))";
  if (label === "bear") return "hsl(var(--bear))";
  return "hsl(var(--neutral))";
}
