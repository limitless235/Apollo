"use client";

import { useCallback, useEffect, useState } from "react";
import { WatchlistStrip, type WatchlistCard } from "@/components/dashboard/WatchlistStrip";
import { SymbolSearch } from "@/components/dashboard/SymbolSearch";
import { StatChips } from "@/components/dashboard/StatChips";
import { NewsFeed, type NewsArticle } from "@/components/dashboard/NewsFeed";
import { PriceChart } from "@/components/charts/PriceChart";
import { SentimentChart } from "@/components/charts/SentimentChart";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartLine, Newspaper, ArrowsClockwise } from "@phosphor-icons/react";
import {
  EmptyWatchlist,
  EmptyNews,
  ChartLoading,
} from "@/components/dashboard/empty-states";

interface ChartData {
  symbol: string;
  companyName: string;
  ohlcv: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  newsMarkers: Array<{
    date: string;
    title: string;
    sentiment: number;
    url: string;
    id?: number;
  }>;
  sentimentTimeline: Array<{
    date: string;
    avgSentiment: number;
    count: number;
  }>;
}

export function Dashboard() {
  const [selected, setSelected] = useState("RELIANCE");
  const [watchlist, setWatchlist] = useState<WatchlistCard[]>([]);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const loadWatchlist = useCallback(async () => {
    const res = await fetch("/api/watchlist/summary");
    const data = await res.json();
    setWatchlist(data.items ?? []);
    setLoading(false);
  }, []);

  const loadChart = useCallback(async (symbol: string) => {
    setChartLoading(true);
    try {
      const [chartRes, newsRes] = await Promise.all([
        fetch(`/api/charts/${symbol}?days=90`),
        fetch(`/api/news?symbol=${symbol}&days=30`),
      ]);
      const chart = await chartRes.json();
      const news = await newsRes.json();
      setChartData(chart);
      setArticles(news.articles ?? []);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  useEffect(() => {
    if (selected) loadChart(selected);
  }, [selected, loadChart]);

  const handleAddWatchlist = async (symbol: string) => {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    setSelected(symbol);
    loadWatchlist();
  };

  const handleRemoveWatchlist = async (symbol: string) => {
    await fetch(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
    loadWatchlist();
    if (selected === symbol && watchlist.length > 1) {
      const next = watchlist.find((w) => w.symbol !== symbol);
      if (next) setSelected(next.symbol);
    }
  };

  const handleIngest = async () => {
    setIngesting(true);
    try {
      await fetch("/api/cron/ingest-news");
      await loadWatchlist();
      await loadChart(selected);
    } finally {
      setIngesting(false);
    }
  };

  const latestClose = chartData?.ohlcv?.[chartData.ohlcv.length - 1]?.close ?? null;
  const changePercent =
    chartData?.ohlcv && chartData.ohlcv.length >= 2
      ? ((latestClose! - chartData.ohlcv[0].close) / chartData.ohlcv[0].close) * 100
      : 0;
  const avgSentiment =
    chartData?.sentimentTimeline && chartData.sentimentTimeline.length > 0
      ? chartData.sentimentTimeline.reduce((s, t) => s + t.avgSentiment, 0) /
        chartData.sentimentTimeline.length
      : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(222,47%,4%)] text-white">
      <div className="haikei-bg pointer-events-none fixed inset-0 opacity-20" />
      <div className="noise-overlay pointer-events-none fixed inset-0 opacity-30" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-4 py-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/20 ring-1 ring-indigo-500/30">
              <ChartLine size={18} className="text-indigo-400" weight="bold" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white">Apollo</h1>
              <p className="text-[11px] text-white/40">NSE news & charts</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SymbolSearch onSelect={setSelected} onAdd={handleAddWatchlist} />
            <ShimmerButton
              onClick={handleIngest}
              disabled={ingesting}
              className="flex items-center gap-2 text-sm"
            >
              <ArrowsClockwise size={14} className={ingesting ? "animate-spin" : ""} />
              {ingesting ? "Pulling…" : "Pull news"}
            </ShimmerButton>
            {ingesting && <span className="live-pulse" title="Ingesting" />}
          </div>
        </header>

        {/* Watchlist strip */}
        <section className="border-b border-white/[0.06] px-4 py-3 lg:px-6">
          {loading ? (
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />
          ) : watchlist.length === 0 ? (
            <EmptyWatchlist />
          ) : (
            <WatchlistStrip
              items={watchlist}
              selected={selected}
              onSelect={setSelected}
              onRemove={handleRemoveWatchlist}
            />
          )}
        </section>

        {/* Stats row */}
        <section className="px-4 py-3 lg:px-6">
          <StatChips
            latestClose={latestClose}
            changePercent={changePercent}
            avgSentiment={avgSentiment}
            newsCount={articles.length}
          />
        </section>

        {/* Main grid: chart + news */}
        <main className="grid flex-1 gap-4 px-4 pb-6 lg:grid-cols-5 lg:px-6">
          {/* Chart column */}
          <div className="lg:col-span-3">
            <Card className="overflow-hidden border-white/[0.08] bg-white/[0.02]">
              <CardHeader className="border-b border-white/[0.06] pb-3">
                <div className="flex items-baseline gap-2">
                  <CardTitle className="font-mono text-lg">{selected}</CardTitle>
                  {chartData?.companyName && (
                    <span className="truncate text-xs text-white/40">{chartData.companyName}</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {chartLoading ? (
                  <ChartLoading />
                ) : (
                  <>
                    <PriceChart
                      ohlcv={chartData?.ohlcv ?? []}
                      newsMarkers={chartData?.newsMarkers ?? []}
                    />
                    <div className="mt-6 border-t border-white/[0.06] pt-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/35">
                        Sentiment
                      </p>
                      <SentimentChart data={chartData?.sentimentTimeline ?? []} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* News column */}
          <div className="lg:col-span-2">
            <Card className="flex h-full flex-col border-white/[0.08] bg-white/[0.02]">
              <CardHeader className="border-b border-white/[0.06] pb-3">
                <div className="flex items-center gap-2">
                  <Newspaper size={16} className="text-indigo-400" />
                  <CardTitle>News</CardTitle>
                  {articles.length > 0 && (
                    <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                      {articles.length}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 pt-3">
                {articles.length === 0 ? (
                  <EmptyNews symbol={selected} />
                ) : (
                  <NewsFeed articles={articles} />
                )}
              </CardContent>
            </Card>
          </div>
        </main>

        <footer className="border-t border-white/[0.06] px-4 py-3 text-center text-[11px] text-white/25 lg:px-6">
          Decision-support tool for personal use. Not investment advice.
        </footer>
      </div>
    </div>
  );
}
