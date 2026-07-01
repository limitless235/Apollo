export function EmptyWatchlist() {
  return (
    <div className="flex items-center justify-center gap-3 py-4 text-center">
      <p className="text-sm text-white/50">Watchlist empty — search a symbol above or run</p>
      <code className="rounded bg-white/[0.06] px-2 py-0.5 text-xs text-indigo-300">
        npm run db:seed
      </code>
    </div>
  );
}

export function EmptyNews({ symbol }: { symbol: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.08]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/30">
          <path d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      </div>
      <p className="text-sm text-white/50">No news for {symbol}</p>
      <p className="text-xs text-white/30">Click Pull news to fetch headlines</p>
    </div>
  );
}

export function ChartLoading() {
  return (
    <div className="flex h-[360px] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-400" />
        <p className="text-xs text-white/35">Loading chart…</p>
      </div>
    </div>
  );
}
