import Link from "next/link";
import { Flame, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import { formatPercent, teamLabel } from "@/lib/elo-format";
import type { EloAchievementView, EloPublicSnapshot } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";

type Kind = keyof EloPublicSnapshot["achievements"];

const META: Record<Kind, { title: string; icon: LucideIcon; tone: string; detail: (v: number) => string }> = {
  mostActive: {
    title: "Am aktivsten",
    icon: Flame,
    tone: "text-warning",
    detail: (v) => `${v} ${v === 1 ? "Match" : "Matches"} gespielt`,
  },
  biggestUpset: {
    title: "Grösste Überraschung",
    icon: Zap,
    tone: "text-team-away",
    detail: (v) => `Gewonnen mit nur ${formatPercent(v)} Siegchance`,
  },
  bestComeback: {
    title: "Bestes Comeback",
    icon: TrendingUp,
    tone: "text-accent",
    detail: (v) => `+${v.toFixed(1)} Elo vom Tiefpunkt aus`,
  },
};

const EMPTY: Record<Kind, string> = {
  mostActive: "Noch keine Matches",
  biggestUpset: "Noch keine Überraschung",
  bestComeback: "Noch kein Comeback",
};

function Card({ kind, a }: { kind: Kind; a: EloAchievementView }) {
  const { title, icon: Icon, tone, detail } = META[kind];
  const body = (
    <>
      <Icon className={cn("size-7 shrink-0", a ? tone : "text-muted-foreground")} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</p>
        {a ? (
          <>
            <p className="font-display text-xl leading-tight break-words">{teamLabel(a.names)}</p>
            <p className="text-muted-foreground text-sm">{detail(a.value)}</p>
          </>
        ) : (
          <p className="text-muted-foreground">{EMPTY[kind]}</p>
        )}
      </div>
    </>
  );
  const cls = "bg-card flex h-full items-start gap-3 rounded-2xl border p-4";
  return a?.matchId ? (
    <Link href={`/elo/matches/${a.matchId}`} className={cn(cls, "hover:border-primary/60 transition-colors")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The three social awards. They never change anyone's Elo. */
export function Achievements({ achievements }: { achievements: EloPublicSnapshot["achievements"] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {(Object.keys(META) as Kind[]).map((k) => (
        <li key={k}>
          <Card kind={k} a={achievements[k]} />
        </li>
      ))}
    </ul>
  );
}
