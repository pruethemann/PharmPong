"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  Flag,
  Hourglass,
  MapPin,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { endTypeLabel, type MatchStatusKey } from "@/lib/i18n/de";
import { sourceLabel } from "@/lib/live-labels";
import type { LiveMatch, LiveTeam } from "@/lib/live-types";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { cn } from "@/lib/utils";
import { bracketColumns, shortCode } from "./bracket-model";

// All sizes are in `em`, so the whole bracket scales with its font size (`scale` prop).

const nodeStatus: Record<MatchStatusKey, { icon: LucideIcon; label: string; className: string }> = {
  PENDING: { icon: CircleDashed, label: "Offen", className: "text-muted-foreground" },
  READY: { icon: Clock, label: "Bereit", className: "text-status-ready" },
  ASSIGNED: { icon: MapPin, label: "Tisch", className: "text-status-assigned" },
  IN_PROGRESS: { icon: CircleDot, label: "Live", className: "bg-live text-accent-foreground" },
  AWAITING_CONFIRMATION: { icon: Hourglass, label: "Bestätigung", className: "text-status-awaiting" },
  COMPLETED: { icon: CircleCheck, label: "Beendet", className: "text-status-completed" },
  CANCELLED: { icon: Ban, label: "Abgesagt", className: "text-muted-foreground line-through" },
  FORFEITED: { icon: Flag, label: "Forfait", className: "text-status-forfeited" },
};

const frame: Record<MatchStatusKey, string> = {
  PENDING: "border-dashed border-border bg-card/60",
  READY: "border-dashed border-status-ready/60 bg-card/80",
  ASSIGNED: "border-status-assigned/70 bg-card",
  IN_PROGRESS:
    "border-live bg-card shadow-[0_0_0_1px_var(--live),0_0_1.5em_-0.25em_color-mix(in_oklch,var(--live)_60%,transparent)]",
  AWAITING_CONFIRMATION: "border-warning/80 bg-warning/5",
  COMPLETED: "border-success/40 bg-card",
  CANCELLED: "border-dashed border-border bg-card/40",
  FORFEITED: "border-success/40 bg-card",
};

const decided = (m: LiveMatch) => m.status === "COMPLETED" || m.status === "FORFEITED";

/** "display" = projector: larger names and tags, same geometry. */
type Variant = "default" | "display";

/** Why the winner won, when it was not a regular finish ("Shootout", "Zeitablauf", "Forfait"). */
function endNote(m: LiveMatch): string | null {
  if (!decided(m) || !m.result) return null;
  if (m.status === "FORFEITED") return endTypeLabel.FORFEIT;
  return m.result.endType === "REGULAR" ? null : endTypeLabel[m.result.endType];
}

function StatusTag({ match, variant }: { match: LiveMatch; variant: Variant }) {
  const s = nodeStatus[match.status];
  const live = match.status === "IN_PROGRESS";
  const Icon = s.icon;
  const label = match.status === "ASSIGNED" && match.tableNumber ? `Tisch ${match.tableNumber}` : s.label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.3em] rounded-full leading-none font-bold whitespace-nowrap",
        variant === "display" ? "text-[0.9em]" : "text-[0.75em]",
        live ? "font-display px-[0.6em] py-[0.3em] tracking-widest uppercase" : "",
        s.className,
      )}
    >
      <Icon className={cn("size-[1.1em]", live && "animate-live-dot")} aria-hidden="true" />
      {label}
    </span>
  );
}

function Slot({
  team,
  source,
  cups,
  state,
  variant,
}: {
  team: LiveTeam | null;
  source: string | null;
  cups: number | null;
  state: "winner" | "loser" | "open";
  variant: Variant;
}) {
  const big = variant === "display";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-[0.5em]",
        big ? "h-[2.6em]" : "h-[2.25em]",
        // No opacity on the losing row: it would push text below 4.5:1 contrast.
        state === "loser" && "text-muted-foreground",
      )}
    >
      {team ? (
        <TeamAvatar
          name={team.name}
          logoUrl={team.logoUrl}
          muted={state === "loser"}
          className={cn(
            "size-[1.75em] rounded-[0.5em] text-[0.7em] ring-[0.1em]",
            state === "winner" && "ring-gold",
          )}
        />
      ) : (
        <span
          className="border-border size-[1.75em] shrink-0 rounded-[0.5em] border-[0.1em] border-dashed"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          big ? "font-display text-[1.35em] leading-none" : "text-[0.95em]",
          team ? (state === "winner" ? "font-bold" : "font-semibold") : "text-muted-foreground italic",
        )}
      >
        {team ? team.name : sourceLabel(source)}
      </span>
      {state === "winner" && <Trophy className="text-gold size-[1em] shrink-0" aria-label="Sieger" />}
      {cups != null && (
        <span
          className={cn(
            "font-display tabular w-[1.4em] text-right leading-none",
            big ? "text-[1.4em]" : "text-[1.15em]",
          )}
        >
          {cups}
        </span>
      )}
    </div>
  );
}

function Node({
  match,
  teamById,
  interactive,
  variant,
}: {
  match: LiveMatch;
  teamById: Map<string, LiveTeam>;
  interactive: boolean;
  variant: Variant;
}) {
  const home = match.homeTeamId ? (teamById.get(match.homeTeamId) ?? null) : null;
  const away = match.awayTeamId ? (teamById.get(match.awayTeamId) ?? null) : null;
  const done = decided(match) && !!match.result;
  const stateOf = (t: LiveTeam | null): "winner" | "loser" | "open" =>
    !done || !t ? "open" : match.result!.winnerTeamId === t.id ? "winner" : "loser";
  const note = endNote(match);
  const describe = `${match.label}: ${home?.name ?? sourceLabel(match.homeSource)} gegen ${
    away?.name ?? sourceLabel(match.awaySource)
  }, ${nodeStatus[match.status].label}${note ? ` (${note})` : ""}`;
  const body = (
    <div
      className={cn(
        "flex w-full flex-col justify-between rounded-[0.9em] border-[0.125em] px-[0.75em] py-[0.5em] transition-colors",
        variant === "display" ? "h-[8.2em]" : "h-[7.5em]",
        frame[match.status],
        interactive && "group-hover/node:border-primary/80",
      )}
    >
      <div className="flex items-center justify-between gap-[0.5em]">
        <span
          className={cn(
            "font-display text-muted-foreground flex min-w-0 items-baseline gap-[0.4em] leading-none tracking-widest",
            variant === "display" ? "text-[0.95em]" : "text-[0.85em]",
          )}
        >
          {/* Link name comes from the content (axe label-content-name-mismatch); the sr-only bits
              give screen readers the same sentence the old aria-label had. */}
          <span className="sr-only">{match.label}: </span>
          {shortCode(match.code)}
          {note && (
            <span className="text-gold truncate font-sans text-[0.9em] font-semibold tracking-normal">
              {note}
            </span>
          )}
        </span>
        <StatusTag match={match} variant={variant} />
      </div>
      <Slot
        team={home}
        source={match.homeSource}
        cups={done ? match.result!.homeCupsRemaining : null}
        state={stateOf(home)}
        variant={variant}
      />
      <span className="sr-only"> gegen </span>
      <Slot
        team={away}
        source={match.awaySource}
        cups={done ? match.result!.awayCupsRemaining : null}
        state={stateOf(away)}
        variant={variant}
      />
    </div>
  );
  return interactive ? (
    <Link
      href={`/matches/${match.id}`}
      className="group/node block w-full rounded-[0.9em] focus-visible:outline-offset-4"
    >
      {body}
    </Link>
  ) : (
    <div aria-label={describe} role="group" className="w-full">
      {body}
    </div>
  );
}

function ChampionNode({ team }: { team: LiveTeam | null }) {
  return (
    <div
      className={cn(
        "flex h-[11em] w-full flex-col items-center justify-center gap-[0.5em] rounded-[1.1em] border-[0.15em] px-[0.75em] text-center",
        team
          ? "border-gold bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--gold)_25%,transparent),transparent_70%)]"
          : "border-gold/40 border-dashed",
      )}
    >
      <Trophy className={cn("size-[2em]", team ? "text-gold" : "text-gold/50")} aria-hidden="true" />
      {team ? (
        <>
          <TeamAvatar
            name={team.name}
            logoUrl={team.logoUrl}
            className="ring-gold size-[3em] rounded-[0.8em] text-[1em] ring-[0.15em]"
          />
          <span className="font-display line-clamp-2 text-[1.3em] leading-tight break-words">
            {team.name}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground text-[0.95em] italic">Sieger Final</span>
      )}
    </div>
  );
}

/** Connector lines between a column of 2n nodes and the next column of n nodes. */
function Connector({ sources }: { sources: LiveMatch[] }) {
  const n = sources.length / 2;
  const y = (i: number) => ((i + 0.5) / sources.length) * 100;
  const on = "stroke-gold";
  const off = "stroke-border";
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-full w-[2em] shrink-0 overflow-visible"
    >
      {Array.from({ length: n }, (_, k) => {
        const a = sources[2 * k];
        const b = sources[2 * k + 1];
        const ya = y(2 * k);
        const yb = y(2 * k + 1);
        const ym = (ya + yb) / 2;
        const aOn = a && decided(a);
        const bOn = b && decided(b);
        return (
          <g key={k} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke">
            <path d={`M0 ${ya} H50 V${ym}`} className={aOn ? on : off} vectorEffect="non-scaling-stroke" />
            <path d={`M0 ${yb} H50 V${ym}`} className={bOn ? on : off} vectorEffect="non-scaling-stroke" />
            <path
              d={`M50 ${ym} H100`}
              className={aOn && bOn ? on : off}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={aOn && bOn ? undefined : "4 4"}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Column({
  title,
  children,
  wide,
  fixed,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Fixed width instead of growing, so the natural size can be measured (projector). */
  fixed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 snap-start flex-col gap-[0.75em]",
        wide ? "w-[13em]" : fixed ? "w-[15em]" : "min-w-[15em] flex-1",
      )}
    >
      <h3 className="font-display text-muted-foreground text-center text-[0.95em] leading-none tracking-widest">
        {title}
      </h3>
      <div className="flex h-[34em] flex-col justify-around">{children}</div>
    </div>
  );
}

function useScrollEdges(ref: React.RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setEdges((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [ref]);
  return edges;
}

/**
 * Knockout bracket: Viertelfinal → Halbfinal → Final → Champion, with connector lines.
 * Scrolls horizontally inside its own container on narrow screens (snap per column,
 * faded edges); the page itself never overflows. `scale` sets the base font size
 * (number = rem, or any CSS length such as a clamp() for the projector).
 */
export function Bracket({
  matches,
  teamById,
  championTeamId,
  scale = 1,
  interactive = true,
  variant = "default",
  showChampion = true,
  className,
}: {
  matches: readonly LiveMatch[];
  teamById: Map<string, LiveTeam>;
  championTeamId: string | null;
  scale?: number | string;
  interactive?: boolean;
  variant?: Variant;
  /** false hides the Champion column (and its connector) while there is no champion yet. */
  showChampion?: boolean;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scroller);
  const cols = bracketColumns(matches);
  if (!cols) return null;
  const champion = championTeamId ? (teamById.get(championTeamId) ?? null) : null;
  const final = cols.final[0];
  const championCol = showChampion || !!champion;

  const fade = 24; // px
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${edges.right ? "transparent" : "#000"} 100%)`
      : undefined;
  const style: CSSProperties = {
    fontSize: typeof scale === "number" ? `${scale}rem` : scale,
    maskImage: mask,
    WebkitMaskImage: mask,
  };

  return (
    <div
      ref={scroller}
      role="region"
      aria-label="K.-o.-Tableau"
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        "w-full max-w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl pb-[0.5em] focus-visible:outline-offset-2",
        className,
      )}
      style={style}
    >
      <div className="flex w-full min-w-max items-stretch px-[0.25em]">
        <Column title="Viertelfinal" fixed={variant === "display"}>
          {cols.quarter.map((m) => (
            <Node key={m.id} match={m} teamById={teamById} interactive={interactive} variant={variant} />
          ))}
        </Column>
        <div className="flex flex-col pt-[1.7em]">
          <div className="h-[34em]">
            <Connector sources={cols.quarter} />
          </div>
        </div>
        <Column title="Halbfinal" fixed={variant === "display"}>
          {cols.semi.map((m) => (
            <Node key={m.id} match={m} teamById={teamById} interactive={interactive} variant={variant} />
          ))}
        </Column>
        <div className="flex flex-col pt-[1.7em]">
          <div className="h-[34em]">
            <Connector sources={cols.semi} />
          </div>
        </div>
        <Column title="Final" fixed={variant === "display"}>
          {final && <Node match={final} teamById={teamById} interactive={interactive} variant={variant} />}
        </Column>
        {championCol && (
          <div className="flex flex-col pt-[1.7em]">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="h-[34em] w-[2em] shrink-0"
            >
              <path
                d="M0 50 H100"
                fill="none"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className={champion ? "stroke-gold" : "stroke-border"}
                strokeDasharray={champion ? undefined : "4 4"}
              />
            </svg>
          </div>
        )}
        {championCol && (
          <Column title="Champion" wide>
            <ChampionNode team={champion} />
          </Column>
        )}
      </div>
    </div>
  );
}
