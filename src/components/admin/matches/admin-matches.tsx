"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Trophy } from "lucide-react";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { EmptyState } from "@/components/pp/section";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { indexTeams, TeamLine, type TeamIndex } from "@/components/admin/live-bits";
import { useAdminAction } from "@/components/admin/use-admin-action";
import {
  matchesFilter,
  PHASE_FILTERS,
  sortByPlayOrder,
  STATUS_FILTERS,
  type PhaseFilter,
  type StatusFilter,
} from "@/lib/admin-matches";
import type { AuthedSnapshot, LiveMatch } from "@/lib/live-types";
import { useLive } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { MatchSheet } from "./match-sheet";
import { RecoveryWizard, type RecoveryRequest } from "./recovery-wizard";

function setMatchParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("match", id);
  else url.searchParams.delete("match");
  window.history.replaceState(window.history.state, "", url.toString());
}

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  counts,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <div className="flex w-max gap-2">
        {options.map((o) => {
          const on = o.value === value;
          const n = counts?.[o.value];
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
              {n != null && (
                <span
                  className={cn(
                    "tabular rounded-full px-1.5 text-xs",
                    on ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultCell({ m, teams }: { m: LiveMatch; teams: TeamIndex }) {
  if (!m.result) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="font-display tabular text-lg">
        {m.result.homeCupsRemaining}:{m.result.awayCupsRemaining}
      </span>
      <Trophy className="text-gold size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate text-sm">{teams.get(m.result.winnerTeamId)?.name ?? "?"}</span>
    </span>
  );
}

export function AdminMatches({
  initial,
  initialMatchId,
}: {
  initial: AuthedSnapshot;
  initialMatchId: string | null;
}) {
  const router = useRouter();
  const { data, connection, clockOffsetMs, refresh } = useLive<AuthedSnapshot>({
    endpoint: "/api/live",
    initial,
  });
  const snap = data ?? initial;
  const refreshAll = useCallback(() => {
    refresh();
    router.refresh();
  }, [refresh, router]);
  const runner = useAdminAction(refresh);
  const online = connection === "online";

  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(initialMatchId);
  const [recovery, setRecovery] = useState<RecoveryRequest | null>(null);

  const teams = useMemo(() => indexTeams(snap.teams), [snap.teams]);
  const issueIds = useMemo(
    () =>
      new Set(
        Object.entries(snap.matchOps ?? {})
          .filter(([, o]) => o.openIssue != null)
          .map(([id]) => id),
      ),
    [snap.matchOps],
  );
  const sorted = useMemo(() => sortByPlayOrder(snap.matches), [snap.matches]);
  const list = sorted.filter((m) => matchesFilter(m, phase, status, issueIds));
  const statusCounts = Object.fromEntries(
    STATUS_FILTERS.map((f) => [
      f.value,
      sorted.filter((m) => matchesFilter(m, phase, f.value, issueIds)).length,
    ]),
  ) as Record<StatusFilter, number>;
  const open = openId ? (snap.matches.find((m) => m.id === openId) ?? null) : null;

  const openMatch = (id: string | null) => {
    setOpenId(id);
    setMatchParam(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {list.length} von {snap.matches.length} Spielen
        </p>
        <ConnectionBadge state={connection} />
      </div>
      <Chips label="Phase" options={PHASE_FILTERS} value={phase} onChange={setPhase} />
      <Chips
        label="Status"
        options={STATUS_FILTERS}
        value={status}
        onChange={setStatus}
        counts={statusCounts}
      />

      {snap.matches.length === 0 ? (
        <EmptyState title="Noch keine Spiele">Die Spiele entstehen mit der Auslosung.</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState title="Keine Treffer">Kein Spiel passt zu diesem Filter.</EmptyState>
      ) : (
        <>
          {/* Phones and tablets: cards */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {list.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openMatch(m.id)}
                  className={cn(
                    "bg-card hover:border-primary/60 flex w-full flex-col gap-2 rounded-2xl border p-4 text-left",
                    m.status === "IN_PROGRESS" && "border-status-live/70",
                    issueIds.has(m.id) && "border-destructive/70",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-2xl leading-none">{m.code}</span>
                    <span className="flex items-center gap-2">
                      {m.tableNumber != null && <TableBadge number={m.tableNumber} size="sm" />}
                      <StatusPill status={m.status} size="sm" />
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">{m.label}</span>
                  <TeamLine
                    teams={teams}
                    teamId={m.homeTeamId}
                    source={m.homeSource}
                    side="home"
                    size="sm"
                    cups={m.result?.homeCupsRemaining}
                    winner={!!m.result && m.result.winnerTeamId === m.homeTeamId}
                  />
                  <TeamLine
                    teams={teams}
                    teamId={m.awayTeamId}
                    source={m.awaySource}
                    side="away"
                    size="sm"
                    cups={m.result?.awayCupsRemaining}
                    winner={!!m.result && m.result.winnerTeamId === m.awayTeamId}
                  />
                  {issueIds.has(m.id) && (
                    <span className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
                      <AlertTriangle className="size-4" aria-hidden="true" /> Problem offen
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: dense table */}
          <div className="bg-card hidden overflow-hidden rounded-2xl border lg:block">
            <table className="w-full table-fixed text-left">
              <caption className="sr-only">Alle Spiele</caption>
              <thead className="text-muted-foreground border-b text-xs tracking-wider uppercase">
                <tr>
                  <th scope="col" className="w-20 px-4 py-3">
                    Spiel
                  </th>
                  <th scope="col" className="w-36 px-2 py-3">
                    Phase
                  </th>
                  <th scope="col" className="px-2 py-3">
                    Teams
                  </th>
                  <th scope="col" className="w-24 px-2 py-3">
                    Tisch
                  </th>
                  <th scope="col" className="w-52 px-2 py-3">
                    Status
                  </th>
                  <th scope="col" className="w-48 px-2 py-3">
                    Resultat
                  </th>
                  <th scope="col" className="w-16 px-2 py-3">
                    <span className="sr-only">Öffnen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={m.id}
                    className={cn(
                      "hover:bg-muted/40 cursor-pointer border-b last:border-b-0",
                      openId === m.id && "bg-primary/5",
                    )}
                    onClick={() => openMatch(m.id)}
                  >
                    <td className="font-display px-4 py-2 text-xl">{m.code}</td>
                    <td className="text-muted-foreground truncate px-2 py-2 text-sm">{m.label}</td>
                    <td className="px-2 py-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <TeamLine
                          teams={teams}
                          teamId={m.homeTeamId}
                          source={m.homeSource}
                          side="home"
                          size="sm"
                        />
                        <TeamLine
                          teams={teams}
                          teamId={m.awayTeamId}
                          source={m.awaySource}
                          side="away"
                          size="sm"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {m.tableNumber != null ? (
                        <TableBadge number={m.tableNumber} size="sm" />
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusPill status={m.status} size="sm" />
                        {issueIds.has(m.id) && (
                          <span className="text-destructive flex items-center gap-1 text-xs font-semibold">
                            <AlertTriangle className="size-3.5" aria-hidden="true" /> Problem offen
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <ResultCell m={m} teams={teams} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMatch(m.id);
                        }}
                        aria-label={`${m.code} öffnen`}
                        className="hover:bg-muted inline-flex size-10 items-center justify-center rounded-xl"
                      >
                        <ChevronRight className="size-5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <MatchSheet
        match={recovery ? null : open}
        snap={snap}
        teams={teams}
        online={online}
        runner={runner}
        clockOffsetMs={clockOffsetMs}
        onClose={() => openMatch(null)}
        onRecovery={setRecovery}
      />
      <RecoveryWizard
        request={recovery}
        onClose={() => setRecovery(null)}
        snap={snap}
        teams={teams}
        online={online}
        refresh={refreshAll}
      />
    </div>
  );
}
