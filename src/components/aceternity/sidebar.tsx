"use client";

import { cn } from "@/lib/utils";
import {
  ChartLine,
  Newspaper,
  Robot,
  SquaresFour,
} from "@phosphor-icons/react";

const links = [
  { label: "Desk", icon: SquaresFour, id: "desk" },
  { label: "Charts", icon: ChartLine, id: "charts" },
  { label: "News", icon: Newspaper, id: "news" },
  { label: "Agent", icon: Robot, id: "agent" },
];

export function AppSidebar({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <aside className="flex w-16 flex-col items-center gap-2 border-r border-white/10 bg-black/20 py-4 md:w-20">
      <div className="mb-4 font-mono text-xs font-bold tracking-widest text-indigo-400">APO</div>
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          onClick={() => onNavigate(link.id)}
          className={cn(
            "flex h-11 w-11 flex-col items-center justify-center rounded-xl text-white/50 transition-all hover:bg-white/10 hover:text-white",
            active === link.id && "bg-indigo-600/20 text-indigo-300"
          )}
          title={link.label}
        >
          <link.icon size={20} weight={active === link.id ? "fill" : "regular"} />
        </button>
      ))}
    </aside>
  );
}
