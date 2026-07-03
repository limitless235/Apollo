"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  Plus,
  PencilSimple,
  Trash,
  TrendUp,
  TrendDown,
  ChartPieSlice,
} from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignalBadge } from "@/components/dashboard/SignalPanel";
import { SymbolSearch, MutualFundSearch } from "@/components/dashboard/SymbolSearch";
import { cn } from "@/lib/utils";
import type { SignalLabel } from "@/lib/scoring/composite";
import type { TradeAction } from "@/lib/scoring/recommendation";

export type PortfolioAssetType = "stock" | "etf" | "mf";

export interface PortfolioHoldingRow {
  id: number;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: number;
  avgCost: number;
  yfinanceTicker: string | null;
  notes: string | null;
}

export interface AnalyzedHoldingRow extends PortfolioHoldingRow {
  currentPrice: number | null;
  priceSource: "live" | "cost" | "unavailable";
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  weight: number;
  changePercent: number | null;
  score: number | null;
  rank: number | null;
  label: SignalLabel | null;
  recommendation: {
    action: TradeAction;
    confidence: string;
    headline: string;
  } | null;
  tickerWarning: string | null;
}

export interface PortfolioAnalysis {
  updatedAt: string;
  holdingCount: number;
  totals: {
    invested: number;
    current: number;
    pnl: number;
    pnlPercent: number;
    pricedHoldings?: number;
    unpricedHoldings?: number;
    byAssetType?: {
      stock: { invested: number; current: number; count: number };
      etf: { invested: number; current: number; count: number };
      mf: { invested: number; current: number; count: number };
    };
  };
  allocation: { stock: number; etf: number; mf: number };
  holdings: AnalyzedHoldingRow[];
  actions: { trim: string[]; hold: string[]; add: string[]; review: string[] };
}

const EMPTY_FORM = {
  symbol: "",
  name: "",
  assetType: "stock" as PortfolioAssetType,
  exchange: "NSE" as "NSE" | "BSE",
  quantity: "",
  avgCost: "",
  yfinanceTicker: "",
  notes: "",
};

function formatInr(value: number, decimals?: boolean): string {
  const useDecimals = decimals ?? Math.abs(value) < 1000;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: useDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function actionVariant(action: TradeAction): "bull" | "bear" | "neutral" | "outline" {
  if (action === "BUY") return "bull";
  if (action === "SELL" || action === "AVOID") return "bear";
  return "neutral";
}

function HoldingForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: typeof EMPTY_FORM & { id?: number };
  onSave: (data: typeof EMPTY_FORM) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Tabs
        value={form.assetType}
        onValueChange={(v) => set("assetType", v as PortfolioAssetType)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="stock" className="flex-1">
            Stock
          </TabsTrigger>
          <TabsTrigger value="etf" className="flex-1">
            ETF
          </TabsTrigger>
          <TabsTrigger value="mf" className="flex-1">
            Mutual fund
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {form.assetType === "mf" ? (
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Search mutual fund
          </label>
          <MutualFundSearch
            onSelect={(pick) => {
              setForm((f) => ({
                ...f,
                symbol: pick.symbol,
                name: pick.schemeName,
                yfinanceTicker: pick.yfinanceTicker,
              }));
            }}
          />
          <p className="text-[10px] text-white/30">
            Search by fund name — e.g. &quot;Parag Parikh Flexi Cap Direct Growth&quot;. Live NAV
            is fetched automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Tabs
            value={form.exchange}
            onValueChange={(v) => {
              const exchange = v as "NSE" | "BSE";
              setForm((f) => ({
                ...f,
                exchange,
                yfinanceTicker: f.symbol
                  ? `${f.symbol}.${exchange === "BSE" ? "BO" : "NS"}`
                  : "",
              }));
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="NSE" className="flex-1">
                NSE
              </TabsTrigger>
              <TabsTrigger value="BSE" className="flex-1">
                BSE
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide text-white/40">
              Search {form.exchange} symbol
            </label>
            <SymbolSearch
              includeBse
              placeholder={`Search ${form.exchange} ticker or company…`}
              onSelect={async (_symbol, pick) => {
                if (!pick) return;
                setForm((f) => ({
                  ...f,
                  symbol: pick.symbol,
                  name: pick.companyName,
                  exchange: pick.exchange,
                  yfinanceTicker: pick.yfinanceTicker,
                }));
              }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">
            {form.assetType === "mf" ? "Scheme code" : "Symbol"}
          </label>
          <Input
            value={form.symbol}
            onChange={(e) => {
              const symbol = e.target.value.toUpperCase();
              setForm((f) => ({
                ...f,
                symbol,
                yfinanceTicker:
                  f.assetType === "mf"
                    ? f.yfinanceTicker
                    : symbol
                      ? `${symbol}.${f.exchange === "BSE" ? "BO" : "NS"}`
                      : "",
              }));
            }}
            placeholder={form.assetType === "mf" ? "e.g. 0P0000YWL1" : "RELIANCE"}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">Name</label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Company or scheme name"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">
            {form.assetType === "mf" ? "Units" : "Quantity"}
          </label>
          <Input
            type="number"
            min="0"
            step="any"
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            placeholder={form.assetType === "mf" ? "150.5" : "10"}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">
            {form.assetType === "mf" ? "Avg NAV (₹)" : "Avg buy price (₹)"}
          </label>
          <Input
            type="number"
            min="0"
            step="any"
            value={form.avgCost}
            onChange={(e) => set("avgCost", e.target.value)}
            placeholder="2500"
            required
          />
        </div>
      </div>

      {form.assetType !== "mf" && (
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">Yahoo ticker</label>
          <Input
            value={form.yfinanceTicker}
            onChange={(e) => set("yfinanceTicker", e.target.value.toUpperCase())}
            placeholder={form.exchange === "BSE" ? "SYMBOL.BO" : "SYMBOL.NS"}
          />
          <p className="text-[10px] text-white/30">
            BSE stocks use <span className="font-mono">.BO</span> suffix (e.g. RELIANCE.BO).
          </p>
        </div>
      )}

      {form.assetType === "mf" && (
        <div className="space-y-1.5">
          <label className="text-[11px] text-white/40">Yahoo ticker (for live NAV)</label>
          <Input
            value={form.yfinanceTicker}
            onChange={(e) => set("yfinanceTicker", e.target.value.toUpperCase())}
            placeholder="e.g. 0P0000YWL1.BO"
          />
          <p className="text-[10px] text-white/30">
            Auto-filled when you pick from search. You can also enter a BSE scheme code like{" "}
            <span className="font-mono">120503.BO</span>.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] text-white/40">Notes (optional)</label>
        <Input
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="SIP, folio, target…"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={saving} className="flex-1">
          {saving ? "Saving…" : initial?.id ? "Update holding" : "Add to portfolio"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function HoldingRow({
  holding,
  onEdit,
  onDelete,
  onSelect,
}: {
  holding: AnalyzedHoldingRow;
  onEdit: () => void;
  onDelete: () => void;
  onSelect?: (symbol: string) => void;
}) {
  const positive = holding.pnl >= 0;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="text-left"
          onClick={() => onSelect?.(holding.symbol)}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-white">
              {holding.assetType === "mf" ? holding.name.slice(0, 24) : holding.symbol}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {holding.assetType}
              {holding.assetType === "mf"
                ? ""
                : holding.yfinanceTicker?.toUpperCase().endsWith(".BO")
                  ? " · BSE"
                  : " · NSE"}
            </Badge>
            {holding.weight >= 25 && (
              <Badge variant="neutral" className="text-[10px]">
                {holding.weight.toFixed(0)}% weight
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {holding.assetType === "mf" ? holding.symbol : holding.name}
          </p>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <PencilSimple size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-rose-300/80"
            onClick={onDelete}
          >
            <Trash size={14} />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-white/35">Qty × avg</p>
          <p className="font-mono text-white/70">
            {holding.quantity} × {formatInr(holding.avgCost, true)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/35">LTP</p>
          <p className="font-mono text-white/80">
            {holding.currentPrice != null ? formatInr(holding.currentPrice, true) : "—"}
          </p>
        </div>
        <div>
          <p className="text-white/35">Invested</p>
          <p className="font-mono text-white/70">{formatInr(holding.investedValue, true)}</p>
        </div>
        <div className="text-right">
          <p className="text-white/35">Current</p>
          <p className="font-mono text-white/80">{formatInr(holding.currentValue, true)}</p>
        </div>
        <div>
          <p className="text-white/35">P&amp;L</p>
          <p className={cn("font-mono", positive ? "text-emerald-400" : "text-rose-400")}>
            {positive ? "+" : ""}
            {formatInr(holding.pnl, true)} ({holding.pnlPercent >= 0 ? "+" : ""}
            {holding.pnlPercent.toFixed(2)}%)
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/35">Day / weight</p>
          <p className="font-mono text-white/70">
            {holding.changePercent != null
              ? `${holding.changePercent >= 0 ? "+" : ""}${holding.changePercent.toFixed(2)}%`
              : "—"}
            {holding.weight > 0 ? ` · ${holding.weight.toFixed(1)}%` : ""}
          </p>
        </div>
      </div>

      {holding.tickerWarning && (
        <p className="mt-2 text-[10px] text-amber-300/80">{holding.tickerWarning}</p>
      )}

      {(holding.label != null || holding.recommendation) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          {holding.label != null && holding.score != null && (
            <SignalBadge
              label={holding.label}
              score={holding.score}
              rank={holding.rank ?? undefined}
              compact
            />
          )}
          {holding.recommendation && (
            <Badge variant={actionVariant(holding.recommendation.action)}>
              {holding.recommendation.action}
            </Badge>
          )}
        </div>
      )}

      {holding.priceSource !== "live" && holding.assetType === "mf" && (
        <p className="mt-2 text-[10px] text-amber-300/70">
          Live NAV unavailable — using avg NAV for value estimate.
        </p>
      )}
    </div>
  );
}

export function PortfolioPanel({
  onSelectSymbol,
  onAnalyzePortfolio,
}: {
  onSelectSymbol?: (symbol: string) => void;
  onAnalyzePortfolio?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio/analysis");
      const data = await res.json();
      setAnalysis(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const saveHolding = async (form: typeof EMPTY_FORM) => {
    const payload = {
      symbol: form.symbol,
      name: form.name,
      assetType: form.assetType,
      quantity: Number(form.quantity),
      avgCost: Number(form.avgCost),
      yfinanceTicker: form.yfinanceTicker || null,
      notes: form.notes || null,
    };
    if (editingId) {
      await fetch(`/api/portfolio?id=${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setEditingId(null);
    setShowForm(false);
    await load();
  };

  const deleteHolding = async (id: number) => {
    await fetch(`/api/portfolio?id=${id}`, { method: "DELETE" });
    if (editingId === id) {
      setEditingId(null);
      setShowForm(false);
    }
    await load();
  };

  const startEdit = (h: AnalyzedHoldingRow) => {
    setEditingId(h.id);
    setShowForm(true);
  };

  const totals = analysis?.totals;
  const positive = (totals?.pnl ?? 0) >= 0;

  return (
    <>
      {analysis && analysis.holdingCount > 0 && (
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Briefcase size={16} className="text-indigo-400" />
                <CardTitle className="text-sm">Portfolio</CardTitle>
                <span className="text-[11px] text-white/35">
                  {analysis.holdingCount} holdings
                </span>
              </div>
              <div className="flex gap-2">
                {onAnalyzePortfolio && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-indigo-300/90"
                    onClick={onAnalyzePortfolio}
                  >
                    Analyze in chat
                  </Button>
                )}
                <Sheet open={open} onOpenChange={setOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]">
                      Manage
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="overflow-y-auto border-white/10 bg-[hsl(222,47%,6%)]">
                    <PortfolioSheetContent
                      analysis={analysis}
                      loading={loading}
                      showForm={showForm}
                      editingId={editingId}
                      onShowForm={() => {
                        setEditingId(null);
                        setShowForm(true);
                      }}
                      onCancelForm={() => {
                        setEditingId(null);
                        setShowForm(false);
                      }}
                      onSave={saveHolding}
                      onEdit={startEdit}
                      onDelete={deleteHolding}
                      onSelectSymbol={(symbol) => {
                        onSelectSymbol?.(symbol);
                        setOpen(false);
                      }}
                      editingHolding={analysis.holdings.find((h) => h.id === editingId)}
                    />
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/35">Invested</p>
                <p className="font-mono text-sm text-white/80">
                  {formatInr(totals?.invested ?? 0, true)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/35">Current (live)</p>
                <p className="font-mono text-sm text-white/80">
                  {formatInr(totals?.current ?? 0, true)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/35">P&amp;L</p>
                <p
                  className={cn(
                    "flex items-center gap-1 font-mono text-sm",
                    positive ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {positive ? <TrendUp size={14} /> : <TrendDown size={14} />}
                  {positive ? "+" : ""}
                  {formatInr(totals?.pnl ?? 0, true)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/35">Return</p>
                <p className={cn("font-mono text-sm", positive ? "text-emerald-400" : "text-rose-400")}>
                  {(totals?.pnlPercent ?? 0) >= 0 ? "+" : ""}
                  {(totals?.pnlPercent ?? 0).toFixed(2)}%
                </p>
              </div>
            </div>
            {(analysis.totals.unpricedHoldings ?? 0) > 0 && (
              <p className="mt-2 text-[10px] text-amber-300/70">
                {analysis.totals.unpricedHoldings} holding(s) excluded from live total — add a valid
                ticker or wait for price fetch.
              </p>
            )}

            {analysis.totals.byAssetType && (
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[10px]">
                {(
                  [
                    ["Stocks", analysis.totals.byAssetType.stock],
                    ["ETFs", analysis.totals.byAssetType.etf],
                    ["Mutual funds", analysis.totals.byAssetType.mf],
                  ] as const
                ).map(([label, bucket]) =>
                  bucket.count > 0 ? (
                    <div key={label}>
                      <p className="font-medium text-white/45">{label}</p>
                      <p className="font-mono text-white/70">
                        {formatInr(bucket.invested, true)} → {formatInr(bucket.current, true)}
                      </p>
                      <p className="text-white/30">{bucket.count} holding(s)</p>
                    </div>
                  ) : null
                )}
              </div>
            )}

            <p className="mt-2 text-[10px] text-white/30">
              Invested = units × avg cost/NAV per holding, summed across {analysis.holdingCount}{" "}
              positions. Prices as of{" "}
              {new Date(analysis.updatedAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              .
            </p>

            {(analysis.actions.trim.length > 0 || analysis.actions.review.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
                {analysis.actions.trim.map((s) => (
                  <Badge key={`trim-${s}`} variant="bear">
                    Trim {s}
                  </Badge>
                ))}
                {analysis.actions.review.map((s) => (
                  <Badge key={`review-${s}`} variant="neutral">
                    Review {s}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(analysis?.holdingCount ?? 0) === 0 && (
        <Sheet open={open} onOpenChange={setOpen}>
          <Card className="border-dashed border-white/[0.12] bg-white/[0.02]">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <ChartPieSlice size={28} className="text-indigo-400/60" />
              <div>
                <p className="text-sm font-medium text-white/80">Track your portfolio</p>
                <p className="mt-1 max-w-sm text-xs text-white/40">
                  Add stocks, ETFs, and mutual funds you own. Apollo will value them, score signals,
                  and analyze holdings in Manager&apos;s Desk.
                </p>
              </div>
              <SheetTrigger asChild>
                <Button className="gap-2">
                  <Plus size={14} />
                  Add holdings
                </Button>
              </SheetTrigger>
            </CardContent>
          </Card>
          <SheetContent className="overflow-y-auto border-white/10 bg-[hsl(222,47%,6%)]">
            <PortfolioSheetContent
              analysis={analysis}
              loading={loading}
              showForm={showForm || (analysis?.holdingCount ?? 0) === 0}
              editingId={editingId}
              onShowForm={() => {
                setEditingId(null);
                setShowForm(true);
              }}
              onCancelForm={() => {
                setEditingId(null);
                setShowForm(false);
              }}
              onSave={saveHolding}
              onEdit={startEdit}
              onDelete={deleteHolding}
              onSelectSymbol={onSelectSymbol}
              editingHolding={analysis?.holdings.find((h) => h.id === editingId)}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

function PortfolioSheetContent({
  analysis,
  loading,
  showForm,
  editingId,
  editingHolding,
  onShowForm,
  onCancelForm,
  onSave,
  onEdit,
  onDelete,
  onSelectSymbol,
}: {
  analysis: PortfolioAnalysis | null;
  loading: boolean;
  showForm: boolean;
  editingId: number | null;
  editingHolding?: AnalyzedHoldingRow;
  onShowForm: () => void;
  onCancelForm: () => void;
  onSave: (form: typeof EMPTY_FORM) => Promise<void>;
  onEdit: (h: AnalyzedHoldingRow) => void;
  onDelete: (id: number) => void;
  onSelectSymbol?: (symbol: string) => void;
}) {
  return (
    <div className="mt-6 space-y-6 pr-6">
      <div>
        <h2 className="text-lg font-semibold text-white">My portfolio</h2>
        <p className="text-xs text-white/40">
          Personal holdings — integrated with signals and Manager&apos;s Desk
        </p>
      </div>

      {analysis && analysis.holdingCount > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">
            Totals check
          </p>
          <div className="mt-2 space-y-1 font-mono text-[11px] text-white/65">
            <div className="flex justify-between">
              <span>Sum invested ({analysis.holdingCount} holdings)</span>
              <span>{formatInr(analysis.totals.invested, true)}</span>
            </div>
            <div className="flex justify-between">
              <span>Sum current (live LTP/NAV)</span>
              <span>{formatInr(analysis.totals.current, true)}</span>
            </div>
            <div className="flex justify-between text-emerald-400/90">
              <span>P&amp;L</span>
              <span>
                {analysis.totals.pnl >= 0 ? "+" : ""}
                {formatInr(analysis.totals.pnl, true)} ({analysis.totals.pnlPercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
      )}

      {analysis && analysis.holdingCount > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-center">
          <div>
            <p className="text-[10px] text-white/35">Stocks</p>
            <p className="font-mono text-sm text-white/75">
              {analysis.allocation.stock.toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] text-white/35">ETFs</p>
            <p className="font-mono text-sm text-white/75">
              {analysis.allocation.etf.toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] text-white/35">Mutual funds</p>
            <p className="font-mono text-sm text-white/75">
              {analysis.allocation.mf.toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue={showForm ? "add" : "holdings"}>
        <TabsList className="w-full">
          <TabsTrigger value="holdings" className="flex-1">
            Holdings
          </TabsTrigger>
          <TabsTrigger value="add" className="flex-1">
            {editingId ? "Edit" : "Add"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="space-y-3 pt-2">
          {loading && <p className="text-xs text-white/35">Loading…</p>}
          {!loading && (analysis?.holdings.length ?? 0) === 0 && (
            <p className="text-xs text-white/40">No holdings yet. Switch to Add tab.</p>
          )}
          {analysis?.holdings.map((h) => (
            <HoldingRow
              key={h.id}
              holding={h}
              onEdit={() => onEdit(h)}
              onDelete={() => onDelete(h.id)}
              onSelect={onSelectSymbol}
            />
          ))}
          {!showForm && (analysis?.holdings.length ?? 0) > 0 && (
            <Button type="button" variant="outline" className="w-full gap-2" onClick={onShowForm}>
              <Plus size={14} />
              Add another
            </Button>
          )}
        </TabsContent>

        <TabsContent value="add" className="pt-2">
          <HoldingForm
            initial={
              editingHolding
                ? {
                    id: editingHolding.id,
                    symbol: editingHolding.symbol,
                    name: editingHolding.name,
                    assetType: editingHolding.assetType,
                    exchange: editingHolding.yfinanceTicker?.toUpperCase().endsWith(".BO")
                      ? "BSE"
                      : "NSE",
                    quantity: String(editingHolding.quantity),
                    avgCost: String(editingHolding.avgCost),
                    yfinanceTicker: editingHolding.yfinanceTicker ?? "",
                    notes: editingHolding.notes ?? "",
                  }
                : undefined
            }
            onSave={async (form) => {
              await onSave(form);
              onCancelForm();
            }}
            onCancel={onCancelForm}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}