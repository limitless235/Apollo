import { cn } from "@/lib/utils";

export function AnimatedShinyText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-gradient-to-r from-white via-white/80 to-white/60 bg-clip-text text-transparent",
        "animate-[shimmer_3s_ease-in-out_infinite] bg-[length:200%_100%]",
        className
      )}
    >
      {children}
    </span>
  );
}
