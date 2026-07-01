"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface SentimentPoint {
  date: string;
  avgSentiment: number;
  count: number;
}

export function SentimentChart({ data }: { data: SentimentPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-white/40">
        No sentiment data yet — pull news to populate
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
          tickFormatter={(v) => v.slice(5)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="sentiment"
          domain={[-1, 1]}
          tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
          width={28}
          axisLine={false}
          tickLine={false}
        />
        <YAxis yAxisId="count" orientation="right" hide domain={[0, "auto"]} />
        <Tooltip
          contentStyle={{
            background: "hsl(222 47% 8%)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            fontSize: 11,
          }}
          labelFormatter={(v) => String(v)}
        />
        <Bar
          yAxisId="count"
          dataKey="count"
          fill="rgba(99,102,241,0.2)"
          radius={[2, 2, 0, 0]}
          name="Articles"
        />
        <Line
          yAxisId="sentiment"
          type="monotone"
          dataKey="avgSentiment"
          stroke="#818cf8"
          strokeWidth={2}
          dot={false}
          name="Sentiment"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
