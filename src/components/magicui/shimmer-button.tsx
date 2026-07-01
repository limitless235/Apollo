"use client";

import { cn } from "@/lib/utils";

export function ShimmerButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "relative inline-flex h-9 items-center justify-center overflow-hidden rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition-all hover:bg-indigo-500 disabled:opacity-50",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent",
        className
      )}
      {...props}
    >
      <span className="relative z-10">{children}</span>
    </button>
  );
}
