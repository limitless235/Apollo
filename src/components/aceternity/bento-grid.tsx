import { cn } from "@/lib/utils";

export function BentoGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-3", className)}>{children}</div>
  );
}

export function BentoGridItem({
  className,
  title,
  description,
  header,
  icon,
  selected,
  onClick,
  onRemove,
}: {
  className?: string;
  title?: string;
  description?: string;
  header?: React.ReactNode;
  icon?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-left transition-all hover:border-indigo-500/30 hover:bg-white/[0.05]",
        selected &&
          "border-indigo-500/50 bg-indigo-500/[0.06] shadow-[0_0_24px_-8px_hsl(var(--glow)/0.25)]",
        className
      )}
    >
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }
          }}
          className="absolute right-2 top-2 z-10 rounded-md p-1 text-white/25 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
          aria-label="Remove from watchlist"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </span>
      )}
      {header}
      <div>
        <div className="flex items-center gap-2">
          {icon}
          {title && <div className="font-mono text-sm font-semibold text-white">{title}</div>}
        </div>
        {description && (
          <div className="mt-0.5 truncate text-[11px] text-white/45">{description}</div>
        )}
      </div>
    </div>
  );
}
