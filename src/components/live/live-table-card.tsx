"use client";

import Link from "next/link";
import { ArrowRight, Ban, Coffee, Hourglass, MapPin } from "lucide-react";
import type { LiveMatch, LiveTable, LiveTeam } from "@/lib/live-types";
import { BigTimer } from "@/components/pp/big-timer";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { cn } from "@/lib/utils";
import { ClientOnly } from "./client-only";
import { isClockRunning, teamOf, type SnapshotIndex } from "./live-view";

function TeamLine({ team, side }: { team: LiveTeam | null; side: "home" | "away" }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {team ? (
        <TeamAvatar name={team.name} logoUrl={team.logoUrl} side={side} size="md" />
      ) : (
        <span
          className="border-border size-12 shrink-0 rounded-2xl border-2 border-dashed"
          aria-hidden="true"
        />
      )}
      <span className="font-display min-w-0 truncate text-2xl leading-tight">
        {team?.name ?? "Noch offen"}
      </span>
    </div>
  );
}

function Hint({ icon, children, tone }: { icon: React.ReactNode; children: React.ReactNode; tone: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm font-semibold [&_svg]:size-4", tone)}>
      {icon}
      {children}
    </p>
  );
}

/** "Jetzt live" card for one table: badge, status, both teams, timer when running. */
export function LiveTableCard({
  table,
  match,
  idx,
  clockOffsetMs,
  nextMatch,
}: {
  table: LiveTable;
  match: LiveMatch | null;
  idx: SnapshotIndex;
  clockOffsetMs: number;
  nextMatch?: LiveMatch | null;
}) {
  if (!match) {
    const disabled = table.state === "DISABLED";
    const nh = nextMatch ? teamOf(idx, nextMatch.homeTeamId) : null;
    const na = nextMatch ? teamOf(idx, nextMatch.awayTeamId) : null;
    return (
      <div className="bg-card/60 flex flex-col gap-3 rounded-2xl border border-dashed p-4">
        <div className="flex items-center justify-between gap-2">
          <TableBadge number={table.number} muted />
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
            {disabled ? (
              <Ban className="size-4" aria-hidden="true" />
            ) : (
              <Coffee className="size-4" aria-hidden="true" />
            )}
            {disabled ? "Gesperrt" : "Frei"}
          </span>
        </div>
        {disabled ? (
          <p className="text-muted-foreground">Dieser Tisch ist vorübergehend nicht in Betrieb.</p>
        ) : nextMatch && nh && na ? (
          <p className="text-muted-foreground">
            Als Nächstes wohl: <span className="text-foreground font-semibold">{nh.name}</span> vs{" "}
            <span className="text-foreground font-semibold">{na.name}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">
            Gerade kein Spiel. Kurz durchatmen, gleich geht&apos;s weiter.
          </p>
        )}
      </div>
    );
  }

  const home = teamOf(idx, match.homeTeamId);
  const away = teamOf(idx, match.awayTeamId);
  const live = match.status === "IN_PROGRESS";
  return (
    <Link
      href={`/matches/${match.id}`}
      // No aria-label: the name comes from the visible content (axe label-content-name-mismatch).
      className="group block rounded-2xl focus-visible:outline-offset-4"
    >
      <article
        className={cn(
          "bg-card group-hover:border-primary/60 flex h-full flex-col gap-3 rounded-2xl border p-4 transition-colors",
          live && "border-status-live/70 shadow-[0_0_0_1px_var(--live)]",
          match.status === "AWAITING_CONFIRMATION" && "border-warning/60",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TableBadge number={table.number} size="lg" />
          <StatusPill status={match.status} />
        </div>
        <p className="font-display text-muted-foreground text-sm tracking-widest">{match.label}</p>
        <div className="flex flex-col gap-2">
          <TeamLine team={home} side="home" />
          <div className="flex items-center gap-3">
            <span className="bg-border h-px flex-1" aria-hidden="true" />
            <span className="font-display text-muted-foreground text-sm">
              <span aria-hidden="true">vs</span>
              <span className="sr-only">gegen</span>
            </span>
            <span className="bg-border h-px flex-1" aria-hidden="true" />
          </div>
          <TeamLine team={away} side="away" />
        </div>
        {isClockRunning(match) && match.timer ? (
          <ClientOnly fallback={<div className="h-14" aria-hidden="true" />}>
            <BigTimer timer={match.timer} clockOffsetMs={clockOffsetMs} size="md" className="py-1" />
          </ClientOnly>
        ) : match.status === "ASSIGNED" ? (
          <Hint icon={<MapPin aria-hidden="true" />} tone="text-status-assigned">
            Teams an den Tisch, gleich geht&apos;s los
          </Hint>
        ) : match.status === "AWAITING_CONFIRMATION" ? (
          <Hint icon={<Hourglass aria-hidden="true" />} tone="text-warning">
            Spiel vorbei, Resultat wird bestätigt
          </Hint>
        ) : null}
        <span className="text-primary mt-auto inline-flex items-center gap-1 text-sm font-semibold">
          Zum Spiel{" "}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </article>
    </Link>
  );
}
