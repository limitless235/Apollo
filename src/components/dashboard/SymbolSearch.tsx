"use client";

import { useState, useEffect, useCallback } from "react";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SymbolResult {
  symbol: string;
  companyName: string;
}

export function SymbolSearch({
  onSelect,
  onAdd,
}: {
  onSelect: (symbol: string) => void;
  onAdd?: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data.results ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, search]);

  return (
    <div className="relative w-full max-w-xs">
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
        />
        <Input
          placeholder="Search symbol or company..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/10 bg-[hsl(var(--surface))] py-1 shadow-xl">
          {results.map((r) => (
            <div
              key={r.symbol}
              className="flex items-center justify-between px-3 py-2 hover:bg-white/5"
            >
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => {
                  onSelect(r.symbol);
                  setQuery(r.symbol);
                  setOpen(false);
                }}
              >
                <span className="font-mono text-sm font-semibold text-white">{r.symbol}</span>
                <span className="ml-2 text-xs text-white/50">{r.companyName}</span>
              </button>
              {onAdd && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onAdd(r.symbol)}
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
