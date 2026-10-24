"use client";

import { Ban, Coffee, Hourglass, MapPin } from "lucide-react";
import type { LiveMatch, LiveTable, LiveTeam } from "@/lib/live-types";
import { BigTimer } from "@/components/pp/big-timer";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { ClientOnly } from "@/components/live/client-only";
import { isClockRunning, teamOf, type SnapshotIndex } from "@/components/live/live-view";
import { cn } from "@/lib/utils";

// Sizes are in `em` of the display root (≈ 1/100 of the screen width, 19.2px at 1080p),
// see DisplayScreen. Minimums from the brief hold in both layouts: team names ≥ 2.5em (3rem),
// timer digits ≥ 6.7em (8rem), and the overtime/paused label stays visible.
//
// layout "wide": tables side by side above the rotating panel (default).
// layout "side": tables stacked in a left column while the bracket fills the rest.

function Team({ team, side, compact }: { team: LiveTeam | null; side: "home" | "away"; compact: boolean }) {
  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-[0.6em]">
        {team ? (
          <TeamAvatar
            name={team.name}
            logoUrl={team.logoUrl}
            side={side}
            className="size-[1.5em] rounded-[0.4em] text-[2em] ring-[0.05em]"
          />
        ) : (
          <span
            className="border-border size-[3em] shrink-0 rounded-[0.8em] border-[0.12em] border-dashed"
            aria-hidden="true"
          />
        )}
        <span className="font-display min-w-0 truncate text-[2.6em] leading-[1.1]">
          {team?.name ?? "Offen"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-center gap-[0.4em] text-center">
      {team ? (
        <TeamAvatar
          name={team.name}
          logoUrl={team.logoUrl}
          side={side}
          className="size-[1.9em] rounded-[0.45em] text-[2.1em] ring-[0.06em]"
        />
      ) : (
        <span
          className="border-border size-[5em] rounded-[1em] border-[0.15em] border-dashed"
          aria-hidden="true"
        />
      )}
      <span className="font-display line-clamp-2 w-full text-[2.8em] leading-[1.02] break-words">
        {team?.name ?? "Offen"}
      </span>
      {team?.motto && (
        <span className="text-muted-foreground line-clamp-1 w-full text-[1.35em] italic">«{team.motto}»</span>
      )}
    </div>
  );
}

function Free({
  table,
  next,
  idx,
  compact,
  started,
}: {
  table: LiveTable;
  next: LiveMatch | null;
  idx: SnapshotIndex;
  compact: boolean;
  started: boolean;
}) {
  const disabled = table.state === "DISABLED";
  const home = next ? teamOf(idx, next.homeTeamId) : null;
  const away = next ? teamOf(idx, next.awayTeamId) : null;
  return (
    <div
      className={cn(
        "bg-card/50 flex h-full min-h-0 flex-col rounded-[1.2em] border-[0.15em] border-dashed",
        compact ? "gap-[0.8em] p-[1.2em]" : "gap-[1em] p-[1.4em]",
      )}
    >
      <div className="flex items-center justify-between gap-[1em]">
        <TableBadge
          number={table.number}
          muted
          className="gap-[0.25em] rounded-[0.35em] border-[0.06em] px-[0.4em] py-[0.15em] text-[2.6em]"
        />
        <span className="text-muted-foreground inline-flex items-center gap-[0.4em] text-[1.5em] font-semibold">
          {disabled ? (
            <Ban className="size-[1em]" aria-hidden="true" />
          ) : (
            <Coffee className="size-[1em]" aria-hidden="true" />
          )}
          {disabled ? "Gesperrt" : "Frei"}
        </span>
      </div>
      {!disabled && home && away ? (
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center",
            compact ? "gap-[0.3em]" : "items-center gap-[0.8em]",
          )}
        >
          <p className="font-display text-primary text-[1.6em] tracking-widest">Nächstes Spiel</p>
          {compact ? (
            <>
              <p className="font-display min-w-0 truncate text-[2.6em] leading-[1.1]">{home.name}</p>
              <p className="font-display text-muted-foreground text-[1.6em] leading-none">vs</p>
              <p className="font-display min-w-0 truncate text-[2.6em] leading-[1.1]">{away.name}</p>
            </>
          ) : (
            <p className="font-display min-w-0 text-center text-[2.8em] leading-tight">
              {home.name} <span className="text-muted-foreground">vs</span> {away.name}
            </p>
          )}
          <p className="text-muted-foreground text-[1.4em]">{next?.label}</p>
        </div>
      ) : (
        <p
          className={cn(
            "text-muted-foreground flex-1 text-[1.8em]",
            !compact && "flex items-center justify-center text-center",
          )}
        >
          {disabled
            ? "Tisch vorübergehend ausser Betrieb"
            : started
              ? "Gleich geht's weiter"
              : "Noch keine Spiele"}
        </p>
      )}
    </div>
  );
}

/** One table on the projector: wide (default) or stacked in a side column (while the bracket is shown). */
export function TablePanel({
  table,
  match,
  next,
  idx,
  clockOffsetMs,
  compact = false,
  started,
}: {
  table: LiveTable;
  match: LiveMatch | null;
  next: LiveMatch | null;
  idx: SnapshotIndex;
  clockOffsetMs: number;
  compact?: boolean;
  started: boolean;
}) {
  if (!match) return <Free table={table} next={next} idx={idx} compact={compact} started={started} />;
  const home = teamOf(idx, match.homeTeamId);
  const away = teamOf(idx, match.awayTeamId);
  const live = match.status === "IN_PROGRESS";
  const clock = isClockRunning(match) && match.timer;
  const timer = clock ? (
    <ClientOnly fallback={<div className="h-[7em]" />}>
      <BigTimer
        timer={match.timer!}
        clockOffsetMs={clockOffsetMs}
        size="xl"
        className={cn(
          compact
            ? "gap-[0.3em] [&>span:first-child]:text-[7em] [&>span:first-child]:leading-[0.9] [&>span:nth-child(2)]:px-[0.8em] [&>span:nth-child(2)]:py-[0.25em] [&>span:nth-child(2)]:text-[1.3em]"
            : "gap-[0.3em] [&>span:first-child]:text-[7.4em] [&>span:first-child]:leading-[0.9] [&>span:nth-child(2)]:px-[0.8em] [&>span:nth-child(2)]:py-[0.25em] [&>span:nth-child(2)]:text-[1.4em]",
        )}
      />
    </ClientOnly>
  ) : null;
  const hint =
    match.status === "ASSIGNED" ? (
      <p className="text-status-assigned flex items-center gap-[0.4em] text-[2em] font-semibold">
        <MapPin className="size-[1em]" aria-hidden="true" /> Gleich geht&apos;s los
      </p>
    ) : match.status === "AWAITING_CONFIRMATION" ? (
      <p className="text-warning flex items-center gap-[0.4em] text-[2em] font-semibold">
        <Hourglass className="size-[1em]" aria-hidden="true" /> Resultat wird bestätigt
      </p>
    ) : null;

  const frame = cn(
    "bg-card relative flex h-full min-h-0 overflow-hidden rounded-[1.2em] border-[0.15em]",
    live &&
      "border-live shadow-[0_0_0_0.1em_var(--live),0_0_2.5em_-0.5em_color-mix(in_oklch,var(--live)_55%,transparent)]",
    match.status === "AWAITING_CONFIRMATION" && "border-warning/70",
    match.status === "ASSIGNED" && "border-status-assigned/70",
  );
  const badge = (
    <TableBadge
      number={table.number}
      className="gap-[0.25em] rounded-[0.35em] border-[0.06em] px-[0.4em] py-[0.15em] text-[2.6em]"
    />
  );
  const pill = (
    <StatusPill status={match.status} size="lg" className="gap-[0.4em] px-[0.8em] py-[0.3em] text-[1.4em]" />
  );

  if (compact) {
    // Stacked: badge + status · both teams · clock (or hint). Same minimum sizes as "wide".
    return (
      <article aria-label={`Tisch ${table.number}`} className={cn(frame, "flex-col gap-[0.6em] p-[1.2em]")}>
        <div className="flex items-center justify-between gap-[1em]">
          <div className="flex min-w-0 items-center gap-[0.8em]">
            {badge}
            <span className="font-display text-muted-foreground truncate text-[1.3em] tracking-widest">
              {match.label}
            </span>
          </div>
          {pill}
        </div>
        <div className="flex min-w-0 flex-col gap-[0.4em]">
          <Team team={home} side="home" compact />
          <Team team={away} side="away" compact />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">{timer ?? hint}</div>
      </article>
    );
  }

  return (
    <article aria-label={`Tisch ${table.number}`} className={cn(frame, "flex-col gap-[0.8em] p-[1.4em]")}>
      <div className="flex items-center justify-between gap-[1em]">
        <div className="flex min-w-0 items-center gap-[1em]">
          {badge}
          <span className="font-display text-muted-foreground truncate text-[1.5em] tracking-widest">
            {match.label}
          </span>
        </div>
        {pill}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-[1em] overflow-hidden">
        <Team team={home} side="home" compact={false} />
        <span className="font-display text-muted-foreground pt-[1.2em] text-[2.2em]">vs</span>
        <Team team={away} side="away" compact={false} />
      </div>
      <div className="flex min-h-[7em] shrink-0 items-center justify-center">{timer ?? hint}</div>
    </article>
  );
}
