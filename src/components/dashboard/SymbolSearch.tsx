"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface SymbolPick {
  symbol: string;
  companyName: string;
  yfinanceTicker: string;
  exchange: "NSE" | "BSE";
  source?: "local" | "yahoo";
}

interface SymbolResult extends SymbolPick {}

export function SymbolSearch({
  onSelect,
  onAdd,
  includeBse = true,
  placeholder = "Search symbol or company...",
}: {
  onSelect: (symbol: string, pick?: SymbolPick) => Promise<void> | void;
  onAdd?: (symbol: string, pick?: SymbolPick) => Promise<void> | void;
  includeBse?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (!includeBse) params.set("includeBse", "0");
        const res = await fetch(`/api/symbols/search?${params}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [includeBse]
  );

  useEffect(() => {
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const pick = async (result: SymbolResult) => {
    const pickMeta: SymbolPick = {
      symbol: result.symbol,
      companyName: result.companyName,
      yfinanceTicker: result.yfinanceTicker,
      exchange: result.exchange,
      source: result.source,
    };
    await onSelect(result.symbol, pickMeta);
    setQuery(result.symbol);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && results.length > 0) {
      event.preventDefault();
      void pick(results[0]);
    }
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative w-full max-w-xs overflow-visible">
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
        />
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="pl-9"
          autoComplete="off"
        />
      </div>
      {showPanel && (
        <div className="absolute z-[100] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-white/15 bg-[hsl(222,47%,6%)] py-1 shadow-2xl ring-1 ring-black/40">
          {loading && <p className="px-3 py-2 text-xs text-white/45">Searching…</p>}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-white/45">
              No matches. Try a ticker{includeBse ? " (NSE or BSE)" : ""} or company name.
            </p>
          )}
          {!loading &&
            results.map((r) => (
              <div
                key={`${r.symbol}-${r.exchange}`}
                className="flex items-center justify-between px-3 py-2 hover:bg-white/5"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 text-left"
                  onClick={() => void pick(r)}
                >
                  <span className="font-mono text-sm font-semibold text-white">{r.symbol}</span>
                  <span className="ml-2 truncate text-xs text-white/50">{r.companyName}</span>
                  <span
                    className={`ml-2 shrink-0 text-[10px] ${
                      r.exchange === "BSE" ? "text-amber-300/80" : "text-indigo-300/70"
                    }`}
                  >
                    {r.exchange}
                  </span>
                </button>
                {onAdd && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => void pick(r)}
                    aria-label={`Add ${r.symbol}`}
                  >
                    <Plus size={14} />
                  </Button>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export interface MutualFundPick {
  symbol: string;
  schemeName: string;
  yfinanceTicker: string;
}

interface MutualFundResult {
  symbol: string;
  companyName: string;
  yfinanceTicker: string;
}

export function MutualFundSearch({
  onSelect,
  placeholder = "Search mutual fund scheme…",
}: {
  onSelect: (pick: MutualFundPick) => Promise<void> | void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MutualFundResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/symbols/search?type=mf&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const pick = async (result: MutualFundResult) => {
    await onSelect({
      symbol: result.symbol,
      schemeName: result.companyName,
      yfinanceTicker: result.yfinanceTicker,
    });
    setQuery(result.companyName);
    setOpen(false);
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative w-full overflow-visible">
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
        />
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && results.length > 0) {
              e.preventDefault();
              void pick(results[0]);
            }
          }}
          className="pl-9"
          autoComplete="off"
        />
      </div>
      {showPanel && (
        <div className="absolute z-[100] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-white/15 bg-[hsl(222,47%,6%)] py-1 shadow-2xl ring-1 ring-black/40">
          {loading && <p className="px-3 py-2 text-xs text-white/45">Searching schemes…</p>}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-white/45">
              No schemes found. Try fund house + plan name (e.g. &quot;Parag Parikh Flexi Cap Direct&quot;).
            </p>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={r.yfinanceTicker}
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-white/5"
                onClick={() => void pick(r)}
              >
                <span className="text-xs leading-snug text-white/85">{r.companyName}</span>
                <span className="font-mono text-[10px] text-white/35">{r.yfinanceTicker}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
