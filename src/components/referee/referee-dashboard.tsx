"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Ban, CircleCheck, CloudOff, Hourglass, MapPin, Pause, Play, type LucideIcon } from "lucide-react";
import { useHydrated } from "@/components/match/safe-timer";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { MatchCard } from "@/components/pp/match-card";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { tableStateLabel, type TableStateKey } from "@/lib/i18n/de";
import type { AuthedSnapshot, LiveMatch, LiveTable } from "@/lib/live-types";
import { EMPTY_DRAFT, hasIdempotencyKey, sessionKeyStore, type ResultDraft } from "@/lib/result-form";
import { useLive } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { currentMatch, matchById, needsAction, suggestionFor, tablePhase, teamById } from "./model";
import { RefereeProvider, type ClosedMatch, type RefereeCtx } from "./referee-context";
import {
  AssignedPanel,
  DisabledPanel,
  EntryPanel,
  FreePanel,
  ReviewPanel,
  RunningPanel,
  SavedPanel,
} from "./table-panels";
import { useMatchAction, type RunFn } from "./use-match-action";

// ─── Persisted table choice (localStorage) ────────────────────────────────

const TABLE_KEY = "pp:referee:table";
const TABLE_EVENT = "pp:referee:table";

function readTable(): string | null {
  try {
    return window.localStorage.getItem(TABLE_KEY);
  } catch {
    return null;
  }
}
function writeTable(id: string) {
  try {
    window.localStorage.setItem(TABLE_KEY, id);
  } catch {
    // ignore (private mode)
  }
  window.dispatchEvent(new Event(TABLE_EVENT));
}
function subscribeTable(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(TABLE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(TABLE_EVENT, cb);
  };
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const STATE_ICON: Record<TableStateKey, LucideIcon> = {
  AVAILABLE: CircleCheck,
  RESERVED: MapPin,
  IN_PROGRESS: Play,
  DISABLED: Ban,
};
const STATE_TONE: Record<TableStateKey, string> = {
  AVAILABLE: "text-success",
  RESERVED: "text-status-assigned",
  IN_PROGRESS: "text-status-live",
  DISABLED: "text-destructive",
};

// ─── Table selector ────────────────────────────────────────────────────────

function TableSelector({
  snap,
  selectedId,
  onSelect,
  now,
}: {
  snap: AuthedSnapshot;
  selectedId: string;
  onSelect: (id: string) => void;
  now: number;
}) {
  return (
    <div
      role="group"
      aria-label="Tisch wählen"
      className="bg-muted/60 grid gap-1.5 rounded-2xl p-1.5"
      style={{ gridTemplateColumns: `repeat(${snap.tables.length}, minmax(0, 1fr))` }}
    >
      {snap.tables.map((t) => {
        const active = t.id === selectedId;
        const awaiting = currentMatch(snap, t)?.status === "AWAITING_CONFIRMATION";
        const Icon = awaiting ? Hourglass : STATE_ICON[t.state];
        const action = needsAction(snap, t, now);
        const stateText = awaiting ? "Bestätigung offen" : tableStateLabel[t.state];
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(t.id)}
            className={cn(
              "relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-colors",
              active ? "bg-card ring-primary shadow-sm ring-2" : "hover:bg-background/60",
            )}
          >
            <span
              className={cn(
                "font-display text-3xl leading-none",
                active ? "text-primary" : "text-foreground",
              )}
            >
              Tisch {t.number}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-semibold",
                awaiting ? "text-status-awaiting" : STATE_TONE[t.state],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {stateText}
            </span>
            {action && <span className="sr-only">, Aktion nötig</span>}
            {action && (
              <span
                aria-hidden="true"
                className="bg-warning ring-card animate-live-dot absolute top-2 right-2 size-3 rounded-full ring-2"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Other tables + up next ───────────────────────────────────────────────

function teamsLine(snap: AuthedSnapshot, m: LiveMatch): string {
  const h = teamById(snap, m.homeTeamId)?.name ?? "Offen";
  const a = teamById(snap, m.awayTeamId)?.name ?? "Offen";
  return `${h} vs ${a}`;
}

function OtherTable({
  snap,
  table,
  onSelect,
}: {
  snap: AuthedSnapshot;
  table: LiveTable;
  onSelect: () => void;
}) {
  const m = currentMatch(snap, table);
  const sug = !m ? suggestionFor(snap, table.id) : null;
  const Icon = STATE_ICON[table.state];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="bg-card hover:border-primary/60 flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors"
    >
      <TableBadge number={table.number} size="md" muted={table.state === "DISABLED"} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {m ? (
          <>
            <span className="truncate font-semibold">{teamsLine(snap, m)}</span>
            <span className="flex items-center gap-2">
              <StatusPill status={m.status} size="sm" />
              <span className="text-muted-foreground truncate text-xs">{m.label}</span>
            </span>
          </>
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", STATE_TONE[table.state])}>
              <Icon className="size-4" aria-hidden="true" />
              {tableStateLabel[table.state]}
            </span>
            <span className="text-muted-foreground truncate text-sm">
              {sug ? `Bereit: ${teamsLine(snap, sug)}` : "Kein Spiel bereit"}
            </span>
          </>
        )}
      </span>
      <span className="text-primary shrink-0 text-sm font-semibold">Wechseln</span>
    </button>
  );
}

function UpNext({ snap }: { snap: AuthedSnapshot }) {
  const next = snap.upNext
    .map((id) => matchById(snap, id))
    .filter((m): m is LiveMatch => m !== null)
    .slice(0, 3);
  if (next.length === 0)
    return <p className="text-muted-foreground text-sm">Keine weiteren Spiele geplant.</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {next.map((m) => (
        <li key={m.id}>
          <MatchCard
            href={`/matches/${m.id}`}
            match={{
              id: m.id,
              code: m.code,
              label: m.label,
              status: m.status,
              home: teamById(snap, m.homeTeamId),
              away: teamById(snap, m.awayTeamId),
              homeSource: m.homeSource,
              awaySource: m.awaySource,
              tableNumber: m.tableNumber,
            }}
          />
        </li>
      ))}
    </ul>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export function RefereeDashboard({ initial }: { initial: AuthedSnapshot }) {
  const { data, connection, clockOffsetMs, refresh, lastUpdated } = useLive<AuthedSnapshot>({
    endpoint: "/api/live",
    initial,
  });
  const snap = data ?? initial;
  const online = connection === "online";
  const { pending, run: rawRun } = useMatchAction({ refresh });

  // After a network loss the outcome is unknown: block writes until a poll answered after it.
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const unverified = failedAt !== null && (lastUpdated ?? 0) < failedAt;
  const run = useCallback<RunFn>(
    async (id, fn, opts = {}) => {
      const out = await rawRun(id, fn, opts);
      if (out.kind === "network") setFailedAt(Date.now());
      return out;
    },
    [rawRun],
  ) as RunFn;
  const ticking = useNow();
  // Before hydration the server and client clocks differ: ignore time-based hints.
  const now = useHydrated() ? ticking : 0;

  // Table choice: localStorage, falling back to the first table.
  const stored = useSyncExternalStore(subscribeTable, readTable, () => null);
  const table = snap.tables.find((t) => t.id === stored) ?? snap.tables[0] ?? null;
  const selectTable = useCallback((id: string) => writeTable(id), []);

  // Per table: the match whose saved/confirmed state is shown until "Nächstes Spiel".
  const [closed, setClosed] = useState<Record<string, ClosedMatch>>({});
  // Per match: the result draft while the referee is in step 1.
  const [drafts, setDrafts] = useState<Record<string, ResultDraft>>({});
  // Per match: minimum version the snapshot must reach before buttons unlock again.
  const [expected, setExpected] = useState<Record<string, number>>({});

  // The result we were reviewing got confirmed (by someone else, or by our own confirm whose
  // response was lost): show it instead of jumping on.
  type Seen = { matchId: string; status: string; rev: number };
  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const seenNow: Record<string, Seen> = {};
  for (const t of snap.tables) {
    const m = currentMatch(snap, t);
    if (m)
      seenNow[t.id] = { matchId: m.id, status: m.status, rev: snap.matchOps?.[m.id]?.resultRevision ?? 0 };
  }
  const seenKey = JSON.stringify(seenNow);
  if (seenKey !== JSON.stringify(seen)) {
    const add: Record<string, ClosedMatch> = {};
    for (const [tableId, prev] of Object.entries(seen)) {
      if (prev.status !== "AWAITING_CONFIRMATION" || seenNow[tableId]?.matchId === prev.matchId) continue;
      const after = matchById(snap, prev.matchId);
      if (after?.result && !closed[tableId]) {
        // A confirm key still stored = our confirm was sent without a definitive answer
        // (in flight or response lost). Then we cannot tell who confirmed. An ok of our own
        // request later replaces this with by: "me".
        const ours = hasIdempotencyKey(sessionKeyStore(), prev.matchId, "confirm", prev.rev);
        add[tableId] = {
          matchId: prev.matchId,
          by: ours ? "unknown" : "other",
          advancedTo: null,
          champion: false,
        };
      }
    }
    setSeen(seenNow);
    if (Object.keys(add).length > 0) setClosed((c) => ({ ...c, ...add }));
  }

  const syncing = useCallback(
    (matchId: string) => {
      const want = expected[matchId];
      if (want === undefined) return false;
      const have = snap.matchOps?.[matchId]?.version ?? 0;
      return have < want;
    },
    [expected, snap.matchOps],
  );
  const expectVersion = useCallback(
    (matchId: string, version: number) => setExpected((e) => ({ ...e, [matchId]: version })),
    [],
  );

  const tableId = table?.id ?? "";
  const closeMatch = useCallback(
    (c: ClosedMatch) => {
      setClosed((x) => ({ ...x, [tableId]: c }));
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[c.matchId];
        return rest;
      });
    },
    [tableId],
  );
  const dismissClosed = useCallback(() => {
    setClosed((x) => {
      const rest = { ...x };
      delete rest[tableId];
      return rest;
    });
  }, [tableId]);

  const ctx: RefereeCtx | null = useMemo(
    () =>
      table
        ? {
            snap,
            table,
            clockOffsetMs,
            online,
            pending,
            run,
            unverified,
            syncing,
            expectVersion,
            closeMatch,
            dismissClosed,
            selectTable,
          }
        : null,
    [
      snap,
      table,
      clockOffsetMs,
      online,
      pending,
      run,
      unverified,
      syncing,
      expectVersion,
      closeMatch,
      dismissClosed,
      selectTable,
    ],
  );

  if (!table || !ctx) {
    return (
      <p className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center">
        Für dieses Turnier sind noch keine Tische eingerichtet.
      </p>
    );
  }

  const m = currentMatch(snap, table);
  const closedHere = closed[table.id];
  const closedMatch = closedHere ? matchById(snap, closedHere.matchId) : null;
  // A "confirmed by someone else" view only makes sense once the result is really there.
  const showClosed =
    closedHere && (closedHere.by === "me" || (closedMatch?.result != null && closedMatch.id !== m?.id));

  let panel: React.ReactNode;
  let phaseText: string;
  if (showClosed) {
    panel = <SavedPanel {...closedHere} />;
    phaseText = closedHere.by === "me" ? "Resultat gespeichert" : "Resultat bereits bestätigt";
  } else {
    const phase = tablePhase(snap, table);
    switch (phase) {
      case "DISABLED":
        panel = <DisabledPanel />;
        phaseText = "Tisch gesperrt";
        break;
      case "FREE_SUGGESTION":
      case "FREE_EMPTY":
        panel = <FreePanel />;
        phaseText = phase === "FREE_SUGGESTION" ? "Nächstes Spiel bereit" : "Kein Spiel bereit";
        break;
      case "ASSIGNED":
        panel = <AssignedPanel m={m!} />;
        phaseText = "Spiel zugewiesen, bereit zum Start";
        break;
      case "IN_PROGRESS": {
        const draft = drafts[m!.id];
        if (draft) {
          panel = (
            <EntryPanel
              m={m!}
              draft={draft}
              onChange={(d) => setDrafts((x) => ({ ...x, [m!.id]: d }))}
              onCancel={() =>
                setDrafts((x) => {
                  const rest = { ...x };
                  delete rest[m!.id];
                  return rest;
                })
              }
            />
          );
          phaseText = "Resultat erfassen";
        } else {
          panel = (
            <RunningPanel m={m!} onEnterResult={() => setDrafts((x) => ({ ...x, [m!.id]: EMPTY_DRAFT }))} />
          );
          phaseText = "Spiel läuft";
        }
        break;
      }
      case "AWAITING_CONFIRMATION":
        panel = <ReviewPanel m={m!} onCorrect={(d) => setDrafts((x) => ({ ...x, [m!.id]: d }))} />;
        phaseText = "Resultat kontrollieren und bestätigen";
        break;
    }
  }

  const others = snap.tables.filter((t) => t.id !== table.id);

  return (
    <RefereeProvider value={ctx}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <p className="font-display text-primary text-sm tracking-widest">Schiri-Modus</p>
            <h1 className="text-3xl leading-none">Mein Tisch</h1>
          </div>
          <ConnectionBadge state={connection} />
        </div>

        {snap.tournament.isPaused && (
          <div
            role="status"
            className="border-warning/60 bg-warning/10 text-warning flex items-start gap-3 rounded-2xl border p-4"
          >
            <Pause className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="font-semibold">
              Turnier pausiert. Laufende Uhren stehen still; neue Spiele starten erst nach der Pause.
            </p>
          </div>
        )}
        {!online && (
          <div
            role="alert"
            className="border-destructive/60 bg-destructive/10 text-destructive flex items-start gap-3 rounded-2xl border p-4"
          >
            <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="font-semibold">
              Keine Verbindung. Alle Aktionen sind gesperrt, bis die Verbindung wieder steht. Deine Eingaben
              bleiben erhalten.
            </p>
          </div>
        )}

        <TableSelector snap={snap} selectedId={table.id} onSelect={selectTable} now={now} />

        <p className="sr-only" aria-live="polite">
          Tisch {table.number}: {phaseText}
        </p>

        {panel}

        {others.length > 0 && (
          <section aria-labelledby="other-tables" className="mt-2 flex flex-col gap-3">
            <h2 id="other-tables" className="text-2xl leading-none">
              {others.length === 1 ? "Anderer Tisch" : "Andere Tische"}
            </h2>
            {others.map((t) => (
              <OtherTable key={t.id} snap={snap} table={t} onSelect={() => selectTable(t.id)} />
            ))}
          </section>
        )}

        <section aria-labelledby="up-next" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="up-next" className="text-2xl leading-none">
              Als Nächstes
            </h2>
            <Link href="/tournament" className="text-primary min-h-12 content-center text-sm font-semibold">
              Spielplan
            </Link>
          </div>
          <UpNext snap={snap} />
        </section>
      </div>
    </RefereeProvider>
  );
}
