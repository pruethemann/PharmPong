"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  Download,
  Flag,
  Hourglass,
  Info,
  Loader2,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  Users,
  UserRound,
  Wrench,
} from "lucide-react";
import { ClientTimer, useMounted } from "@/components/admin/client-timer";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { EmptyState, Section } from "@/components/pp/section";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { ReasonField } from "@/components/admin/fields";
import { KpiTile } from "@/components/admin/kpi-tile";
import { indexTeams, TableStatePill, TeamLine, type TeamIndex } from "@/components/admin/live-bits";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { relativeFromNow } from "@/lib/admin-labels";
import { deriveAlerts, type AdminAlert } from "@/lib/admin-matches";
import { tournamentStatusLabel } from "@/lib/i18n/de";
import type { AuthedSnapshot, LiveMatch, LiveTable } from "@/lib/live-types";
import { useLive, type Connection } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { assignMatchAction, unassignMatchAction } from "@/server/actions/matches";
import { setPublicDisplayAction } from "@/server/actions/elo-admin";
import { pauseTournamentAction, resumeTournamentAction } from "@/server/actions/tournament";

export type OverviewCounts = {
  registeredPlayers: number;
  playersInTeams: number;
  teams: number;
  completeTeams: number;
  incompleteTeams: number;
  requiredTeams: number;
  referees: number;
};

function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function AdminOverview({
  initial,
  counts,
  incompleteTeams,
}: {
  initial: AuthedSnapshot;
  counts: OverviewCounts;
  incompleteTeams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { data, connection, clockOffsetMs, refresh, lastUpdated } = useLive<AuthedSnapshot>({
    endpoint: "/api/live",
    initial,
  });
  const snap = data ?? initial;

  // Server-rendered counts (teams/users) follow the live revision.
  const seenRevision = useRef(snap.revision);
  useEffect(() => {
    if (seenRevision.current !== snap.revision) {
      seenRevision.current = snap.revision;
      router.refresh();
    }
  }, [snap.revision, router]);

  const refreshAll = useCallback(() => {
    refresh();
    router.refresh();
  }, [refresh, router]);
  const { run, pending } = useAdminAction(refreshAll);
  const online = connection === "online";

  const teams = useMemo(() => indexTeams(snap.teams), [snap.teams]);
  const alerts = useMemo(() => deriveAlerts(snap, { incompleteTeams }), [snap, incompleteTeams]);
  const openIssues = Object.values(snap.matchOps ?? {}).filter((o) => o.openIssue != null).length;
  const pendingConfirmations = snap.admin?.pendingConfirmations ?? 0;
  const t = snap.tournament;
  const nowTick = useNow();
  const mounted = useMounted();
  const now = mounted ? nowTick : null;
  const groupDone = snap.matches.filter(
    (m) => m.stage === "GROUP" && (m.status === "COMPLETED" || m.status === "FORFEITED"),
  ).length;
  const koDone = snap.matches.filter(
    (m) => m.stage === "KNOCKOUT" && (m.status === "COMPLETED" || m.status === "FORFEITED"),
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground min-w-0 truncate text-sm">
          <span className="text-foreground font-semibold">{t.name}</span>
          {t.isPaused && <span className="text-warning font-semibold"> · pausiert</span>}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs" aria-live="off">
            Rev. <span className="tabular">{snap.revision}</span> ·{" "}
            {now == null ? "–" : relativeFromNow(lastUpdated, now)}
          </span>
          <ConnectionBadge state={connection} />
        </div>
      </div>

      <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          icon={UserRound}
          label="Spieler:innen"
          value={counts.playersInTeams}
          sub={`${counts.registeredPlayers} registriert · ${counts.referees} ${counts.referees === 1 ? "Schiri" : "Schiris"}`}
        />
        <KpiTile
          icon={Users}
          label="Teams komplett"
          value={`${counts.completeTeams}/${counts.requiredTeams}`}
          sub={counts.incompleteTeams > 0 ? `${counts.incompleteTeams} unvollständig` : "keine unvollständig"}
          tone={counts.incompleteTeams > 0 ? "warning" : "default"}
        />
        <KpiTile
          icon={t.isPaused ? Pause : Flag}
          label="Phase"
          value={
            <span className="block text-2xl leading-tight whitespace-normal">
              {tournamentStatusLabel[t.status]}
            </span>
          }
          sub={t.isPaused ? "Pausiert" : `Gruppen ${groupDone}/12 · K.-o. ${koDone}/7`}
          tone={t.isPaused ? "warning" : "default"}
        />
        <KpiTile
          icon={Hourglass}
          label="Zu bestätigen"
          value={pendingConfirmations}
          sub={pendingConfirmations ? "Schiri muss bestätigen" : "alles bestätigt"}
          tone={pendingConfirmations ? "warning" : "default"}
        />
        <KpiTile
          icon={AlertTriangle}
          label="Offene Probleme"
          value={openIssues}
          sub={openIssues ? "Schiri-Meldungen" : "keine Meldungen"}
          tone={openIssues ? "destructive" : "default"}
        />
        <KpiTile
          icon={RefreshCw}
          label="Revision"
          value={snap.revision}
          sub={`Stand ${now == null ? "–" : relativeFromNow(lastUpdated ?? snap.serverNow - clockOffsetMs, now)}`}
        />
      </section>

      <AlertList alerts={alerts} />

      <Section title="Tische">
        {snap.tables.length === 0 ? (
          <EmptyState title="Keine Tische">Tische werden mit dem Turnier angelegt.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {snap.tables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                snap={snap}
                teams={teams}
                clockOffsetMs={clockOffsetMs}
                online={online}
                pending={pending}
                onAssign={(match) =>
                  run(
                    `assign-${table.id}`,
                    () =>
                      assignMatchAction({
                        matchId: match.id,
                        tableId: table.id,
                        expectedVersion: snap.matchOps?.[match.id]?.version ?? 0,
                      }),
                    { success: `${match.code} an Tisch ${table.number} zugewiesen.` },
                  )
                }
                onUnassign={(match) =>
                  run(
                    `unassign-${match.id}`,
                    () =>
                      unassignMatchAction({
                        matchId: match.id,
                        expectedVersion: snap.matchOps?.[match.id]?.version ?? 0,
                      }),
                    { success: `Zuweisung von ${match.code} aufgehoben.` },
                  )
                }
              />
            ))}
          </div>
        )}
      </Section>

      <UpNext snap={snap} teams={teams} />

      <Controls
        snap={snap}
        connection={connection}
        pending={pending}
        onPause={(reason) =>
          run("pause", () => pauseTournamentAction(reason ? { reason } : {}), {
            success: "Turnier pausiert.",
          })
        }
        onResume={() => run("resume", () => resumeTournamentAction(), { success: "Turnier fortgesetzt." })}
        onPublic={(enabled) =>
          // setPublicDisplay works in every tournament status (e.g. Elo Mode after the final).
          run("public", () => setPublicDisplayAction({ enabled }), {
            success: enabled ? "Öffentliche Anzeige eingeschaltet." : "Öffentliche Anzeige ausgeschaltet.",
          })
        }
      />
    </div>
  );
}

// ─── Alerts ────────────────────────────────────────────────────────────────

const ALERT_ICON = { destructive: AlertTriangle, warning: Hourglass, info: Info } as const;

function AlertList({ alerts }: { alerts: AdminAlert[] }) {
  return (
    <Section title="Handlungsbedarf">
      <div aria-live="polite" className="contents">
        {alerts.length === 0 ? (
          <div className="border-success/50 bg-success/10 text-success flex items-center gap-3 rounded-2xl border p-4 font-semibold">
            <CheckCheck className="size-5 shrink-0" aria-hidden="true" />
            Alles im grünen Bereich. Keine offenen Punkte.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => {
              const Icon = ALERT_ICON[a.tone];
              return (
                <li
                  key={a.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center",
                    a.tone === "destructive" && "border-destructive/50 bg-destructive/10",
                    a.tone === "warning" && "border-warning/50 bg-warning/10",
                    a.tone === "info" && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Icon
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        a.tone === "destructive" && "text-destructive",
                        a.tone === "warning" && "text-warning",
                        a.tone === "info" && "text-primary",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold">{a.title}</p>
                      {a.detail && <p className="text-muted-foreground line-clamp-2 text-sm">{a.detail}</p>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    render={<Link href={a.href} />}
                    nativeButton={false}
                  >
                    {a.cta}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ─── Tables ────────────────────────────────────────────────────────────────

function TableCard({
  table,
  snap,
  teams,
  clockOffsetMs,
  online,
  pending,
  onAssign,
  onUnassign,
}: {
  table: LiveTable;
  snap: AuthedSnapshot;
  teams: TeamIndex;
  clockOffsetMs: number;
  online: boolean;
  pending: string | null;
  onAssign: (m: LiveMatch) => void;
  onUnassign: (m: LiveMatch) => void;
}) {
  const match = table.currentMatchId ? snap.matches.find((m) => m.id === table.currentMatchId) : null;
  const suggestionId = snap.admin?.suggestions.find((s) => s.tableId === table.id)?.matchId;
  const suggestion = suggestionId ? snap.matches.find((m) => m.id === suggestionId) : null;
  const issue = match ? snap.matchOps?.[match.id]?.openIssue : null;
  const live = match?.status === "IN_PROGRESS";

  return (
    <article
      aria-label={`Tisch ${table.number}`}
      className={cn(
        "bg-card flex flex-col gap-4 rounded-2xl border p-4",
        live && "border-status-live/70 shadow-[0_0_0_1px_var(--live)]",
        table.state === "DISABLED" && "border-destructive/50",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <TableBadge number={table.number} size="lg" muted={table.state === "DISABLED"} />
          <span className="text-muted-foreground truncate text-sm">{table.name}</span>
        </div>
        <TableStatePill state={table.state} />
      </header>

      {match ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xl leading-none">
              {match.code} <span className="text-muted-foreground text-base">· {match.label}</span>
            </p>
            <StatusPill status={match.status} size="sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex min-w-0 flex-col gap-2">
              <TeamLine teams={teams} teamId={match.homeTeamId} source={match.homeSource} side="home" />
              <TeamLine teams={teams} teamId={match.awayTeamId} source={match.awaySource} side="away" />
            </div>
            {match.timer?.startedAt != null && (
              <ClientTimer timer={match.timer} clockOffsetMs={clockOffsetMs} />
            )}
          </div>
          {issue != null && (
            <p className="border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Problem gemeldet: {issue || "ohne Beschreibung"}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={match.status === "AWAITING_CONFIRMATION" || issue != null ? "warning" : "outline"}
              render={<Link href={`/admin/matches?match=${encodeURIComponent(match.id)}`} />}
              nativeButton={false}
              className="flex-1 sm:flex-none"
            >
              <Wrench aria-hidden="true" />
              {match.status === "AWAITING_CONFIRMATION" ? "Resultat prüfen" : "Spiel verwalten"}
            </Button>
            {match.status === "ASSIGNED" && (
              <Button
                variant="ghost"
                disabled={!online || pending !== null}
                onClick={() => onUnassign(match)}
                className="flex-1 sm:flex-none"
              >
                {pending === `unassign-${match.id}` && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Zuweisung aufheben
              </Button>
            )}
          </div>
        </div>
      ) : table.state === "DISABLED" ? (
        <p className="text-muted-foreground">
          Gesperrt. Freigeben unter{" "}
          <Link href="/admin/tournament#tische" className="text-primary underline underline-offset-4">
            Turnier › Tische
          </Link>
          .
        </p>
      ) : suggestion ? (
        <div className="border-primary/40 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-3">
          <p className="text-primary text-sm font-semibold">Vorschlag für diesen Tisch</p>
          <p className="font-display text-xl leading-none">
            {suggestion.code} <span className="text-muted-foreground text-base">· {suggestion.label}</span>
          </p>
          <div className="flex min-w-0 flex-col gap-2">
            <TeamLine teams={teams} teamId={suggestion.homeTeamId} side="home" />
            <TeamLine teams={teams} teamId={suggestion.awayTeamId} side="away" />
          </div>
          <Button
            size="lg"
            disabled={!online || pending !== null}
            onClick={() => onAssign(suggestion)}
            aria-label={`${suggestion.code} an Tisch ${table.number} zuweisen`}
          >
            {pending === `assign-${table.id}` ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
            Zuweisen
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {snap.tournament.isPaused
            ? "Turnier pausiert: keine Zuweisungen."
            : snap.tournament.status === "GROUP_STAGE" || snap.tournament.status === "KNOCKOUT_STAGE"
              ? "Frei. Aktuell kein spielbereites Spiel."
              : "Frei."}
        </p>
      )}
    </article>
  );
}

// ─── Up next ───────────────────────────────────────────────────────────────

function UpNext({ snap, teams }: { snap: AuthedSnapshot; teams: TeamIndex }) {
  const list = snap.upNext
    .map((id) => snap.matches.find((m) => m.id === id))
    .filter((m): m is LiveMatch => !!m);
  if (list.length === 0) return null;
  return (
    <Section
      title="Als Nächstes"
      action={
        <Button variant="ghost" render={<Link href="/admin/matches" />} nativeButton={false}>
          Alle Spiele <ArrowRight aria-hidden="true" />
        </Button>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((m, i) => (
          <li key={m.id}>
            <Link
              href={`/admin/matches?match=${encodeURIComponent(m.id)}`}
              className="bg-card hover:border-primary/60 flex min-h-12 flex-col gap-2 rounded-2xl border p-3"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-display text-lg leading-none">
                  <span className="text-muted-foreground tabular mr-2">{i + 1}.</span>
                  {m.code}
                </span>
                <StatusPill status={m.status} size="sm" />
              </span>
              <TeamLine teams={teams} teamId={m.homeTeamId} source={m.homeSource} side="home" size="sm" />
              <TeamLine teams={teams} teamId={m.awayTeamId} source={m.awaySource} side="away" size="sm" />
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ─── Controls ──────────────────────────────────────────────────────────────

function Controls({
  snap,
  connection,
  pending,
  onPause,
  onResume,
  onPublic,
}: {
  snap: AuthedSnapshot;
  connection: Connection;
  pending: string | null;
  onPause: (reason: string) => Promise<{ ok: boolean } | null>;
  onResume: () => Promise<unknown>;
  onPublic: (enabled: boolean) => Promise<unknown>;
}) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const t = snap.tournament;
  const online = connection === "online";
  const canPause = t.status === "GROUP_STAGE" || t.status === "KNOCKOUT_STAGE";

  return (
    <Section title="Steuerung" className="scroll-mt-24">
      <div id="steuerung" className="grid scroll-mt-24 gap-4 lg:grid-cols-3">
        <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h3 className="flex items-center gap-2 text-xl leading-none">
            {t.isPaused ? (
              <Pause className="text-warning size-5" aria-hidden="true" />
            ) : (
              <Play className="text-success size-5" aria-hidden="true" />
            )}
            Turnierbetrieb
          </h3>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {t.isPaused
              ? "Pausiert: Keine Zuweisungen und Starts. Laufende Uhren sind angehalten."
              : canPause
                ? "Läuft. Pausieren stoppt alle Uhren und blockiert neue Zuweisungen."
                : "Pausieren ist nur in der Gruppen- oder K.-o.-Phase möglich."}
          </p>
          {t.isPaused ? (
            <Button
              variant="success"
              size="lg"
              disabled={!online || pending !== null}
              onClick={() => void onResume()}
            >
              {pending === "resume" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              Turnier fortsetzen
            </Button>
          ) : (
            <Button
              variant="warning"
              size="lg"
              disabled={!online || pending !== null || !canPause}
              onClick={() => {
                setReason("");
                setPauseOpen(true);
              }}
            >
              <Pause aria-hidden="true" />
              Turnier pausieren
            </Button>
          )}
        </div>

        <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h3 className="flex items-center gap-2 text-xl leading-none">
            <MonitorPlay className="text-primary size-5" aria-hidden="true" />
            Öffentliche Anzeige
          </h3>
          <p className="text-muted-foreground text-sm">
            Beamer-Ansicht unter{" "}
            <Link href="/display" className="text-primary underline underline-offset-4">
              /display
            </Link>
            . Zeigt nie E-Mails oder Admin-Daten.
          </p>
          <label className="bg-muted/40 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-2">
            <span className="font-semibold">
              {t.publicDisplayEnabled ? "Eingeschaltet" : "Ausgeschaltet"}
            </span>
            <Switch
              checked={t.publicDisplayEnabled}
              disabled={!online || pending !== null}
              onCheckedChange={(v) => void onPublic(v)}
              aria-label="Öffentliche Anzeige"
            />
          </label>
        </div>

        <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h3 className="flex items-center gap-2 text-xl leading-none">
            <Download className="text-primary size-5" aria-hidden="true" />
            Export & Backup
          </h3>
          <div className="flex flex-col gap-2">
            {[
              { format: "json", label: "Komplett-Backup (JSON)" },
              { format: "standings.csv", label: "Rangliste (CSV)" },
              { format: "matches.csv", label: "Spiele & Resultate (CSV)" },
            ].map((x) => (
              <Button
                key={x.format}
                variant="outline"
                className="justify-start"
                render={<a href={`/api/admin/export?format=${x.format}`} download />}
                nativeButton={false}
              >
                <Download aria-hidden="true" />
                {x.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <AdminDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title="Turnier pausieren?"
        description="Alle laufenden Uhren werden angehalten, neue Zuweisungen und Starts sind blockiert."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPauseOpen(false)}>
              Zurück
            </Button>
            <Button
              variant="warning"
              disabled={!online || pending !== null}
              onClick={async () => {
                const res = await onPause(reason.trim());
                if (res?.ok) setPauseOpen(false);
              }}
            >
              {pending === "pause" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Pause aria-hidden="true" />
              )}
              Jetzt pausieren
            </Button>
          </>
        }
      >
        <ReasonField
          id="pause-reason"
          label="Grund (optional, erscheint im Audit-Log)"
          value={reason}
          onChange={setReason}
          min={0}
          placeholder="z. B. Pizza ist da"
        />
      </AdminDialog>
    </Section>
  );
}
