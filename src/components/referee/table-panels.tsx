"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  CircleCheckBig,
  Coffee,
  Hourglass,
  Lock,
  Pause,
  Play,
  ClipboardPen,
  Trophy,
  TriangleAlert,
  Undo2,
  Crown,
  Ban,
} from "lucide-react";
import { SafeBigTimer as BigTimer } from "@/components/match/safe-timer";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { Button } from "@/components/ui/button";
import { endTypeLabel, tournamentStatusLabel } from "@/lib/i18n/de";
import { sourceLabel } from "@/lib/live-labels";
import type { LiveMatch } from "@/lib/live-types";
import {
  checkDraft,
  clearIdempotencyKey,
  cupsScored,
  draftFromProposal,
  draftToResult,
  getOrCreateIdempotencyKey,
  otherSide,
  sessionKeyStore,
  withCups,
  withEndType,
  type ResultDraft,
  type Side,
} from "@/lib/result-form";
import { cn } from "@/lib/utils";
import {
  assignMatchAction,
  confirmResultAction,
  pauseMatchAction,
  proposeResultAction,
  rejectProposalAction,
  resumeMatchAction,
  startMatchAction,
  unassignMatchAction,
} from "@/server/actions/matches";
import { formatTime, isOwnMatch, matchById, nextLabelOf, suggestionFor, teamById } from "./model";
import { useReferee, type RefereeCtx } from "./referee-context";
import { ReportIssueDialog } from "./report-issue-dialog";
import { CupStepper, EndTypeControl, FieldHint, WinnerCard } from "./result-controls";
import { TeamHero, TeamVersus, sideLabel } from "./team-hero";

// ─── Shared bits ───────────────────────────────────────────────────────────

type Gate = { blocked: boolean; reason: string | null };

/** Why a mutation button is disabled (null = allowed). */
function gate(
  ctx: RefereeCtx,
  m: LiveMatch | null,
  opts: { needsUnpaused?: boolean; ownTeamBlocks?: boolean } = {},
): Gate {
  if (!ctx.online) {
    return { blocked: true, reason: "Offline: Aktionen sind gesperrt, bis die Verbindung wieder steht." };
  }
  if (ctx.unverified) {
    return {
      blocked: true,
      reason:
        "Verbindung war unterbrochen: Aktueller Stand wird geladen. Danach bitte prüfen, ob es schon gespeichert ist.",
    };
  }
  if (m && ctx.syncing(m.id)) return { blocked: true, reason: null };
  if (opts.needsUnpaused && ctx.snap.tournament.isPaused) {
    return { blocked: true, reason: "Turnier pausiert: Die Turnierleitung muss zuerst fortsetzen." };
  }
  if (opts.ownTeamBlocks !== false && isOwnMatch(ctx.snap, m)) {
    return {
      blocked: true,
      reason: "Spiel deines eigenen Teams: Bitte eine andere Schiedsrichter:in übernehmen lassen.",
    };
  }
  return { blocked: ctx.pending !== null, reason: null };
}

function GateNote({ gate: g }: { gate: Gate }) {
  if (!g.reason) return null;
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm" role="note">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {g.reason}
    </p>
  );
}

function PanelCard({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <section
      aria-label="Aktueller Tisch"
      className={cn("bg-card flex flex-col gap-5 rounded-3xl border p-4 sm:p-6", tone, className)}
    >
      {children}
    </section>
  );
}

function MatchHeader({ m, kicker }: { m: LiveMatch; kicker?: string }) {
  const ctx = useReferee();
  const issue = ctx.snap.matchOps?.[m.id]?.openIssue ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {kicker && <p className="font-display text-primary text-sm tracking-widest">{kicker}</p>}
          <h2 className="truncate text-3xl leading-none sm:text-4xl">{m.label}</h2>
        </div>
        <div className="flex items-center gap-2">
          {m.tableNumber != null && <TableBadge number={m.tableNumber} size="sm" />}
          <StatusPill status={m.status} size="sm" />
        </div>
      </div>
      {issue !== null && (
        <p className="border-warning/50 bg-warning/10 text-warning flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Problem gemeldet{issue ? `: «${issue}»` : ""}. Die Turnierleitung kümmert sich darum.</span>
        </p>
      )}
      {isOwnMatch(ctx.snap, m) && (
        <p className="border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Das ist ein Spiel deines Teams. Eine andere Schiedsrichter:in muss es leiten.
        </p>
      )}
    </div>
  );
}

function SyncingLabel({ m, children }: { m: LiveMatch; children: ReactNode }) {
  const ctx = useReferee();
  if (ctx.syncing(m.id)) return <>Wird aktualisiert …</>;
  return <>{children}</>;
}

function ReportIssue({ m }: { m: LiveMatch }) {
  const ctx = useReferee();
  return (
    <ReportIssueDialog
      matchId={m.id}
      matchLabel={m.label}
      disabled={!ctx.online}
      pending={ctx.pending === "issue"}
      run={ctx.run}
    />
  );
}

// ─── a) Free table ─────────────────────────────────────────────────────────

export function FreePanel() {
  const ctx = useReferee();
  const { snap, table } = ctx;
  const m = suggestionFor(snap, table.id);
  if (!m) return <FreeEmpty />;
  const ops = snap.matchOps?.[m.id];
  const g = gate(ctx, m, { needsUnpaused: true, ownTeamBlocks: false });

  async function assign() {
    if (!m || !ops) return;
    const out = await ctx.run(
      "assign",
      () => assignMatchAction({ matchId: m.id, tableId: table.id, expectedVersion: ops.version }),
      { successToast: `${m.label} ist auf Tisch ${table.number}` },
    );
    if (out.kind === "ok") ctx.expectVersion(m.id, out.data.version);
  }

  return (
    <PanelCard>
      <MatchHeader m={m} kicker="Nächstes Spiel" />
      <TeamHero
        home={teamById(snap, m.homeTeamId)}
        away={teamById(snap, m.awayTeamId)}
        homePlaceholder={sourceLabel(m.homeSource)}
        awayPlaceholder={sourceLabel(m.awaySource)}
        size="lg"
      />
      <Button size="xl" className="w-full" disabled={g.blocked || !ops} onClick={assign}>
        <ArrowRight aria-hidden="true" />
        {ctx.pending === "assign" ? (
          "Wird geholt …"
        ) : (
          <SyncingLabel m={m}>Auf Tisch {table.number} holen</SyncingLabel>
        )}
      </Button>
      <GateNote gate={g} />
      <p className="text-muted-foreground text-sm">
        Vorschlag der Spielplanung für Tisch {table.number}. Ruf beide Teams an den Tisch und hol das Spiel
        dann hierher.
      </p>
    </PanelCard>
  );
}

function FreeEmpty() {
  const { snap, table } = useReferee();
  const t = snap.tournament;
  const playing = t.status === "GROUP_STAGE" || t.status === "KNOCKOUT_STAGE";
  let icon = <Coffee />;
  let title = "Gerade kein Spiel bereit";
  let text: ReactNode =
    "Alle verfügbaren Spiele laufen schon oder warten auf Teams, die noch an einem anderen Tisch spielen. Sobald ein Spiel bereit ist, erscheint es hier.";
  if (t.isPaused) {
    icon = <Pause />;
    title = "Turnier pausiert";
    text = "Neue Spiele können erst nach der Pause auf den Tisch geholt werden.";
  } else if (t.status === "COMPLETED") {
    const champ = teamById(snap, t.championTeamId);
    icon = <Crown />;
    title = "Turnier beendet";
    text = champ ? `Champion: ${champ.name}. Danke fürs Schiedsrichtern!` : "Danke fürs Schiedsrichtern!";
  } else if (!playing) {
    icon = <CalendarClock />;
    title = tournamentStatusLabel[t.status];
    text = "Die Spiele starten, sobald die Turnierleitung die Gruppenphase eröffnet.";
  } else if (
    t.status === "GROUP_STAGE" &&
    snap.matches
      .filter((x) => x.stage === "GROUP")
      .every((x) => x.status === "COMPLETED" || x.status === "FORFEITED")
  ) {
    icon = <Trophy />;
    title = "Gruppenphase fertig";
    text = "Die K.-o.-Phase startet, sobald die Turnierleitung sie freigibt.";
  } else if (snap.upNext.length === 0) {
    icon = <Hourglass />;
    title = "Warten auf Resultate";
    text = "Die nächsten Spiele hängen von Resultaten ab, die noch nicht bestätigt sind.";
  }
  return (
    <PanelCard className="items-center py-10 text-center">
      <TableBadge number={table.number} size="lg" muted />
      <div className="text-primary [&_svg]:size-12" aria-hidden="true">
        {icon}
      </div>
      <h2 className="text-3xl leading-none">{title}</h2>
      <p className="text-muted-foreground max-w-md">{text}</p>
    </PanelCard>
  );
}

export function DisabledPanel() {
  const { table } = useReferee();
  return (
    <PanelCard className="items-center py-10 text-center">
      <TableBadge number={table.number} size="lg" muted />
      <Lock className="text-destructive size-12" aria-hidden="true" />
      <h2 className="text-3xl leading-none">Tisch gesperrt</h2>
      <p className="text-muted-foreground max-w-md">
        Die Turnierleitung hat diesen Tisch gesperrt. Hier werden keine Spiele zugewiesen.
      </p>
    </PanelCard>
  );
}

// ─── b) Assigned ───────────────────────────────────────────────────────────

export function AssignedPanel({ m }: { m: LiveMatch }) {
  const ctx = useReferee();
  const ops = ctx.snap.matchOps?.[m.id];
  const g = gate(ctx, m, { needsUnpaused: true });
  const gUnassign = gate(ctx, m, { ownTeamBlocks: false });

  async function start() {
    if (!ops) return;
    const out = await ctx.run(
      "start",
      () => startMatchAction({ matchId: m.id, expectedVersion: ops.version }),
      {
        successToast: "Spiel gestartet. Die Uhr läuft!",
      },
    );
    if (out.kind === "ok") ctx.expectVersion(m.id, out.data.version);
  }
  async function unassign() {
    if (!ops) return;
    const out = await ctx.run(
      "unassign",
      () => unassignMatchAction({ matchId: m.id, expectedVersion: ops.version }),
      { successToast: `${m.label} ist zurück in der Warteschlange` },
    );
    if (out.kind === "ok") ctx.expectVersion(m.id, out.data.version);
  }

  return (
    <PanelCard>
      <MatchHeader m={m} kicker="Bereit am Tisch" />
      <TeamHero home={teamById(ctx.snap, m.homeTeamId)} away={teamById(ctx.snap, m.awayTeamId)} />
      <Button size="xl" variant="accent" className="w-full" disabled={g.blocked || !ops} onClick={start}>
        <Play aria-hidden="true" />
        {ctx.pending === "start" ? "Wird gestartet …" : <SyncingLabel m={m}>Spiel starten</SyncingLabel>}
      </Button>
      <GateNote gate={g} />
      <p className="text-muted-foreground text-sm">
        Becher aufgestellt, beide Teams da? Dann starten. Die Uhr läuft ab dem Tippen{" "}
        {Math.round(ctx.snap.tournament.matchDurationSec / 60)} Minuten.
      </p>
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-between">
        <Button variant="ghost" disabled={gUnassign.blocked || !ops} onClick={unassign}>
          <Undo2 aria-hidden="true" />
          {ctx.pending === "unassign" ? "Wird freigegeben …" : "Zurück in die Warteschlange"}
        </Button>
        <ReportIssue m={m} />
      </div>
    </PanelCard>
  );
}

// ─── c) In progress ────────────────────────────────────────────────────────

export function RunningPanel({ m, onEnterResult }: { m: LiveMatch; onEnterResult: () => void }) {
  const ctx = useReferee();
  const ops = ctx.snap.matchOps?.[m.id];
  const paused = m.timer?.pausedAt != null;
  const gPause = gate(ctx, m, { needsUnpaused: paused });
  const gEnter = gate(ctx, m);

  async function togglePause() {
    if (!ops) return;
    const out = await ctx.run(
      "pause",
      () =>
        paused
          ? resumeMatchAction({ matchId: m.id, expectedVersion: ops.version })
          : pauseMatchAction({ matchId: m.id, expectedVersion: ops.version }),
      { successToast: paused ? "Uhr läuft weiter" : "Uhr pausiert" },
    );
    if (out.kind === "ok") ctx.expectVersion(m.id, out.data.version);
  }

  return (
    <PanelCard tone="border-status-live/60">
      <MatchHeader m={m} />
      <TeamVersus home={teamById(ctx.snap, m.homeTeamId)} away={teamById(ctx.snap, m.awayTeamId)} />
      {m.timer && <BigTimer timer={m.timer} clockOffsetMs={ctx.clockOffsetMs} size="lg" className="py-2" />}
      <Button size="xl" className="w-full" disabled={gEnter.blocked} onClick={onEnterResult}>
        <ClipboardPen aria-hidden="true" />
        <SyncingLabel m={m}>Resultat erfassen</SyncingLabel>
      </Button>
      <GateNote gate={gEnter.reason ? gEnter : gPause} />
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-between">
        <Button variant="outline" size="lg" disabled={gPause.blocked || !ops} onClick={togglePause}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {ctx.pending === "pause" ? "Moment …" : paused ? "Uhr fortsetzen" : "Uhr pausieren"}
        </Button>
        <ReportIssue m={m} />
      </div>
    </PanelCard>
  );
}

// ─── d) Result entry (step 1) ──────────────────────────────────────────────

export function EntryPanel({
  m,
  draft,
  onChange,
  onCancel,
}: {
  m: LiveMatch;
  draft: ResultDraft;
  onChange: (d: ResultDraft) => void;
  onCancel: () => void;
}) {
  const ctx = useReferee();
  const ops = ctx.snap.matchOps?.[m.id];
  const home = teamById(ctx.snap, m.homeTeamId);
  const away = teamById(ctx.snap, m.awayTeamId);
  const names = { home: home?.name ?? "Team A", away: away?.name ?? "Team B" };
  const check = checkDraft(draft, names);
  const hint = (f: "endType" | "cups" | "winner") => check.hints.find((h) => h.field === f)?.text;
  const g = gate(ctx, m);

  async function submit() {
    if (!ops || !m.homeTeamId || !m.awayTeamId) return;
    const payload = draftToResult(draft, { home: m.homeTeamId, away: m.awayTeamId });
    if (!payload || !check.valid) return;
    const store = sessionKeyStore();
    const rev = ops.resultRevision;
    const idempotencyKey = getOrCreateIdempotencyKey(store, m.id, "propose", rev);
    const out = await ctx.run("propose", () =>
      proposeResultAction({ matchId: m.id, expectedVersion: ops.version, idempotencyKey, ...payload }),
    );
    if (out.kind === "ok") {
      clearIdempotencyKey(store, m.id, "propose", rev);
      ctx.expectVersion(m.id, out.data.version);
    } else if (out.kind === "error") {
      clearIdempotencyKey(store, m.id, "propose", rev);
    }
  }

  const pick = (side: Side) => onChange({ ...draft, winner: side });
  const locked = g.blocked && ctx.pending !== null;

  return (
    <PanelCard>
      <MatchHeader m={m} kicker="Resultat erfassen · Schritt 1 von 2" />
      {m.timer && <BigTimer timer={m.timer} clockOffsetMs={ctx.clockOffsetMs} size="md" className="-mt-2" />}

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display mb-2 text-xl">1 · Wie hat das Spiel geendet?</legend>
        <EndTypeControl
          value={draft.endType}
          onChange={(t) => onChange(withEndType(draft, t))}
          disabled={locked}
          describedBy={hint("endType") ? "hint-endtype" : undefined}
        />
        <FieldHint id="hint-endtype" text={hint("endType")} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display mb-2 text-xl">2 · Wie viele Becher stehen noch?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["home", "away"] as const).map((side) => (
            <CupStepper
              key={side}
              side={side}
              team={side === "home" ? home : away}
              value={side === "home" ? draft.homeCups : draft.awayCups}
              onChange={(v) => onChange(withCups(draft, side, v))}
              disabled={locked}
              showZero={draft.endType === "REGULAR"}
              describedBy={hint("cups") ? "hint-cups" : undefined}
            />
          ))}
        </div>
        <FieldHint id="hint-cups" text={hint("cups")} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display mb-2 text-xl">
          3 · {draft.endType === "SHOOTOUT" ? "Wer hat den Shootout gewonnen?" : "Wer hat gewonnen?"}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {(["home", "away"] as const).map((side) => (
            <WinnerCard
              key={side}
              side={side}
              team={side === "home" ? home : away}
              selected={draft.winner === side}
              dimmed={draft.winner === otherSide(side)}
              suggested={check.suggested === side}
              onSelect={() => pick(side)}
              disabled={locked}
              describedBy={hint("winner") ? "hint-winner" : undefined}
            />
          ))}
        </div>
        <FieldHint id="hint-winner" text={hint("winner")} />
      </fieldset>

      <div className="flex flex-col gap-3 border-t pt-4">
        <Button size="xl" className="w-full" disabled={g.blocked || !check.valid || !ops} onClick={submit}>
          {ctx.pending === "propose" ? "Wird gespeichert …" : "Weiter zur Kontrolle"}
          <ArrowRight aria-hidden="true" />
        </Button>
        <GateNote gate={g} />
        <Button variant="ghost" onClick={onCancel} disabled={ctx.pending === "propose"}>
          Abbrechen, zurück zur Uhr
        </Button>
      </div>
    </PanelCard>
  );
}

// ─── e) Review (step 2) ────────────────────────────────────────────────────

export function ReviewPanel({ m, onCorrect }: { m: LiveMatch; onCorrect: (d: ResultDraft) => void }) {
  const ctx = useReferee();
  const ops = ctx.snap.matchOps?.[m.id];
  const proposal = ops?.proposal ?? null;
  const home = teamById(ctx.snap, m.homeTeamId);
  const away = teamById(ctx.snap, m.awayTeamId);
  const g = gate(ctx, m);

  if (!ops || !proposal) {
    return (
      <PanelCard>
        <MatchHeader m={m} />
        <p className="text-muted-foreground">Vorschlag wird geladen …</p>
      </PanelCard>
    );
  }
  const winnerSide: Side = proposal.winnerTeamId === m.homeTeamId ? "home" : "away";
  const winner = winnerSide === "home" ? home : away;
  const winnerName = winner?.name ?? sideLabel(winnerSide);
  const h = proposal.homeCupsRemaining;
  const a = proposal.awayCupsRemaining;
  const byMe = proposal.proposedById === ctx.snap.me.userId;

  async function confirm() {
    if (!ops) return;
    const store = sessionKeyStore();
    const rev = ops.resultRevision;
    const idempotencyKey = getOrCreateIdempotencyKey(store, m.id, "confirm", rev);
    const out = await ctx.run("confirm", () =>
      confirmResultAction({
        matchId: m.id,
        expectedVersion: ops.version,
        resultRevision: rev,
        idempotencyKey,
      }),
    );
    if (out.kind === "ok") {
      clearIdempotencyKey(store, m.id, "confirm", rev);
      ctx.closeMatch({
        matchId: m.id,
        by: "me",
        advancedTo: out.data.advanced?.toCode ?? null,
        champion: !!out.data.championTeamId,
      });
    } else if (out.kind === "error") {
      clearIdempotencyKey(store, m.id, "confirm", rev);
      if (out.result.code === "STALE_VERSION") {
        // Most likely another referee confirmed first: show their result once the snapshot has it.
        ctx.closeMatch({ matchId: m.id, by: "other", advancedTo: null, champion: false });
      }
    }
  }

  async function correct() {
    if (!ops || !proposal) return;
    const out = await ctx.run(
      "reject",
      () => rejectProposalAction({ matchId: m.id, expectedVersion: ops.version }),
      { successToast: "Zurück zur Erfassung" },
    );
    if (out.kind === "ok") {
      ctx.expectVersion(m.id, out.data.version);
      onCorrect(draftFromProposal(proposal, { home: m.homeTeamId, away: m.awayTeamId }));
    }
  }

  return (
    <PanelCard tone="border-status-awaiting/60">
      <MatchHeader m={m} kicker="Kontrolle · Schritt 2 von 2" />
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center",
          winnerSide === "home"
            ? "border-team-home/60 bg-team-home/10"
            : "border-team-away/60 bg-team-away/10",
        )}
        aria-live="polite"
      >
        <Trophy className="text-gold size-10" aria-hidden="true" />
        <p className="font-display text-4xl leading-none break-words sm:text-5xl">
          <span className="sr-only">Sieger: </span>
          {winnerName} gewinnt
        </p>
        <p className="font-display tabular flex items-baseline gap-3 text-6xl leading-none">
          <span className="text-team-home">{h}</span>
          <span className="text-muted-foreground text-4xl">:</span>
          <span className="text-team-away">{a}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Becher übrig ·{" "}
          <span className="text-foreground font-semibold">{endTypeLabel[proposal.endType]}</span>
        </p>
        {proposal.endType === "SHOOTOUT" && (
          <p className="text-sm">
            Gleichstand nach Zeitablauf, Sieg im Shootout (zählt nicht zur Becherstatistik).
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        {(["home", "away"] as const).map((side) => {
          const team = side === "home" ? home : away;
          return (
            <div
              key={side}
              className={cn(
                "bg-muted/50 flex min-w-0 flex-col gap-1 rounded-2xl border-2 p-3",
                side === "home" ? "border-team-home/50" : "border-team-away/50",
              )}
            >
              <dt className="flex min-w-0 flex-col text-sm">
                <span className="text-muted-foreground">Erzielte Becher</span>
                <span className="truncate font-semibold">{team?.name ?? sideLabel(side)}</span>
              </dt>
              <dd className="font-display tabular text-4xl leading-none">{cupsScored(side, h, a)}</dd>
            </div>
          );
        })}
      </dl>

      <p className="text-muted-foreground text-center text-sm">
        Erfasst {byMe ? "von dir" : "von einer Schiedsrichter:in"} um {formatTime(proposal.proposedAt)} Uhr.
        Stimmt alles? Erst nach dem Bestätigen zählt das Resultat.
      </p>

      <div className="flex flex-col gap-3">
        <HoldToConfirm
          tone="success"
          onConfirm={confirm}
          disabled={g.blocked}
          className="min-h-20 text-xl sm:text-2xl"
        >
          {ctx.pending === "confirm"
            ? "Wird gespeichert …"
            : ctx.syncing(m.id)
              ? "Wird aktualisiert …"
              : "Gedrückt halten zum Bestätigen"}
        </HoldToConfirm>
        <GateNote gate={g} />
        <Button variant="outline" size="lg" onClick={correct} disabled={g.blocked}>
          <Undo2 aria-hidden="true" />
          {ctx.pending === "reject" ? "Moment …" : "Korrigieren"}
        </Button>
      </div>
      <div className="flex justify-end border-t pt-4">
        <ReportIssue m={m} />
      </div>
    </PanelCard>
  );
}

// ─── f) Saved ──────────────────────────────────────────────────────────────

export function SavedPanel({
  matchId,
  by,
  advancedTo,
  champion,
}: {
  matchId: string;
  by: "me" | "other" | "unknown";
  advancedTo: string | null;
  champion: boolean;
}) {
  const ctx = useReferee();
  const m = matchById(ctx.snap, matchId);
  const r = m?.result ?? null;
  const winner = r ? teamById(ctx.snap, r.winnerTeamId) : null;
  const toCode = by === "me" ? advancedTo : m?.stage === "KNOCKOUT" ? m.nextCode : null;
  const isChampion = by === "me" ? champion : m?.stage === "KNOCKOUT" && !m.nextCode && !!r;

  return (
    <PanelCard tone="border-success/60" className="animate-pop-in items-center text-center">
      <div className="bg-success/15 text-success flex size-24 items-center justify-center rounded-full">
        <CircleCheckBig className="size-14" aria-hidden="true" />
      </div>
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-4xl leading-none">
          {by === "me"
            ? "Resultat gespeichert"
            : by === "other"
              ? "Bereits bestätigt"
              : "Resultat ist bestätigt"}
        </h2>
        {by === "other" && (
          <p className="text-muted-foreground">
            Eine andere Schiedsrichter:in hat dieses Resultat schon bestätigt.
          </p>
        )}
        {by === "unknown" && (
          <p className="text-muted-foreground">
            Der Server hat das Resultat als bestätigt gespeichert. Es zählt.
          </p>
        )}
      </div>
      {m && (
        <p className="font-display text-muted-foreground text-lg tracking-wide">
          {m.label}
          {m.tableNumber != null ? ` · Tisch ${m.tableNumber}` : ""}
        </p>
      )}
      {r ? (
        <div className="flex flex-col items-center gap-1">
          <p className="font-display flex items-center gap-2 text-3xl leading-none break-words">
            <Trophy className="text-gold size-7 shrink-0" aria-hidden="true" />
            {winner?.name ?? "Sieger"}
          </p>
          <p className="text-muted-foreground">
            <span className="font-display tabular text-foreground text-2xl">
              {r.homeCupsRemaining} : {r.awayCupsRemaining}
            </span>{" "}
            Becher übrig · {endTypeLabel[r.endType]}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">Resultat wird geladen …</p>
      )}
      {isChampion ? (
        <p className="bg-gold/15 text-gold font-display animate-glow inline-flex items-center gap-2 rounded-full px-5 py-2 text-2xl">
          <Crown className="size-6" aria-hidden="true" /> Champion {winner?.name ?? ""}
        </p>
      ) : toCode ? (
        <p className="bg-primary/10 text-primary font-display inline-flex items-center gap-2 rounded-full px-5 py-2 text-xl">
          <ArrowRight className="size-5" aria-hidden="true" /> Weiter in {nextLabelOf(toCode)}
        </p>
      ) : null}
      <Button size="xl" className="w-full" onClick={ctx.dismissClosed}>
        Nächstes Spiel
        <ArrowRight aria-hidden="true" />
      </Button>
    </PanelCard>
  );
}
