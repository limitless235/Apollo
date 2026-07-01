"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  createSeriesMarkers,
  type ISeriesApi,
} from "lightweight-charts";
import { sentimentLabel } from "@/lib/utils";

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsMarker {
  date: string;
  title: string;
  sentiment: number;
  url: string;
  id?: number;
}

const SENTIMENT_COLORS = {
  bull: "#34d399",
  bear: "#fb7185",
  neutral: "#64748b",
};

const MAX_MARKERS = 12;

/** Keep at most one marker per day — strongest absolute sentiment wins. Cap total. */
function pickChartMarkers(markers: NewsMarker[]): NewsMarker[] {
  const byDate = new Map<string, NewsMarker>();

  for (const m of markers) {
    const existing = byDate.get(m.date);
    if (!existing || Math.abs(m.sentiment) > Math.abs(existing.sentiment)) {
      byDate.set(m.date, m);
    }
  }

  return Array.from(byDate.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_MARKERS)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function PriceChart({
  ohlcv,
  newsMarkers,
}: {
  ohlcv: OhlcvBar[];
  newsMarkers: NewsMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || ohlcv.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.5)",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      width: containerRef.current.clientWidth,
      height: 360,
      timeScale: { borderColor: "rgba(255,255,255,0.08)", barSpacing: 8 },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
    });

    series.setData(
      ohlcv.map((bar) => ({
        time: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
    );

    const picked = pickChartMarkers(newsMarkers);
    if (picked.length > 0) {
      createSeriesMarkers(
        series,
        picked.map((m) => ({
          time: m.date,
          position: "aboveBar" as const,
          color: SENTIMENT_COLORS[sentimentLabel(m.sentiment)],
          shape: "circle" as const,
          size: 0.6,
        }))
      );
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [ohlcv, newsMarkers]);

  if (ohlcv.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-white/40">
        No price data available
      </div>
    );
  }

  const markerCount = pickChartMarkers(newsMarkers).length;

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      {markerCount > 0 && (
        <div className="mt-2 flex items-center gap-4 text-[11px] text-white/35">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Bullish
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> Bearish
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-500" /> Neutral
          </span>
          <span className="ml-auto">{markerCount} news days on chart</span>
        </div>
      )}
    </div>
  );
}
