import { Card, CardContent } from "@/components/ui/card";

export function StatChips({
  latestClose,
  changePercent,
  avgSentiment,
  newsCount,
}: {
  latestClose: number | null;
  changePercent: number;
  avgSentiment: number;
  newsCount: number;
}) {
  const chips = [
    {
      label: "Price",
      value: latestClose != null ? `₹${latestClose.toLocaleString("en-IN")}` : "—",
    },
    {
      label: "90d change",
      value: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
      color: changePercent >= 0 ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Sentiment",
      value: avgSentiment.toFixed(2),
      color:
        avgSentiment >= 0.2
          ? "text-emerald-400"
          : avgSentiment <= -0.2
            ? "text-rose-400"
            : "text-amber-400",
    },
    { label: "Articles", value: String(newsCount) },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Card
          key={chip.label}
          className="rounded-lg border-white/[0.06] bg-white/[0.02] shadow-none"
        >
          <CardContent className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-white/35">{chip.label}</span>
            <span className={`font-mono text-sm font-medium ${chip.color ?? "text-white/90"}`}>
              {chip.value}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
