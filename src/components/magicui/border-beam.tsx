"use client";

import { cn } from "@/lib/utils";

export function BorderBeam({ className, active }: { className?: string; active?: boolean }) {
  if (!active) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-2xl",
        "before:absolute before:inset-0 before:rounded-2xl before:p-px",
        "before:bg-gradient-to-r before:from-indigo-500 before:via-purple-500 before:to-indigo-500",
        "before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[mask-composite:xor]",
        "before:animate-[spin_4s_linear_infinite]",
        className
      )}
    />
  );
}
