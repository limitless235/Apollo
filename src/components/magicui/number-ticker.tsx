"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function NumberTicker({
  value,
  className,
  suffix = "",
}: {
  value: number;
  className?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = prev.current;
    const end = value;
    const duration = 500;
    const startTime = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      const current = start + (end - start) * progress;
      el!.textContent = `${current >= 0 ? "+" : ""}${current.toFixed(2)}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    prev.current = value;
  }, [value, suffix]);

  return (
    <span
      ref={ref}
      className={cn(
        "font-mono text-sm font-semibold tabular-nums",
        value >= 0 ? "text-emerald-400" : "text-rose-400",
        className
      )}
    >
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}
