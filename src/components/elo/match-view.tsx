"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CircleSlash,
  Flag,
  Hourglass,
  LogOut,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  cancelEloMatchAction,
  confirmEloResultAction,
  consentEloRosterAction,
  disputeEloResultAction,
  leaveEloMatchAction,
  pauseEloMatchAction,
  resumeEloMatchAction,
  startEloMatchAction,
  submitEloResultAction,
} from "@/server/actions/elo";
import { previewMatchup } from "@/server/domain/elo/preview";
import type { EloMatchDetail } from "@/server/services/elo-read";
import { clockTime, teamLabel } from "@/lib/elo-format";
import { eloEndTypeLabel } from "@/lib/i18n/de-elo";
import type { EloLiveMatch, EloMatchOps, EloSideKey } from "@/lib/elo-live-types";
import { ReasonField } from "@/components/admin/fields";
import { ClientOnly } from "@/components/live/client-only";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { PageTitle } from "@/components/pp/section";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EloLiveProvider, useEloLive, type EloLiveMode, type EloSnapshot } from "./elo-live";
import { EloStatusPill, eloPillKey } from "./elo-status-pill";
import { EloTeamLine } from "./elo-team";
import { ConfirmDialog, matchFromDetail, MatchTimeline, SideCard, useDialog } from "./match-parts";
import { CompletedResult } from "./match-result";
import { StaffPanel } from "./match-staff";
import { MatchupPreviewPanel } from "./matchup-preview";
import { ResultEntry } from "./result-entry";
import { Stopwatch } from "./stopwatch";
import { useEloAction } from "./use-elo-action";

const OPEN_STATUSES: readonly string[] = ["DRAFT", "IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"];

const sideOf = (m: EloLiveMatch, userId: string | null): EloSideKey | null =>
  !userId
    ? null
    : m.sideA.some((p) => p.userId === userId)
      ? "A"
      : m.sideB.some((p) => p.userId === userId)
        ? "B"
        : null;
const other = (s: EloSideKey): EloSideKey => (s === "A" ? "B" : "A");

function Compact({ m }: { m: EloLiveMatch }) {
  return (
    <div className="bg-card flex flex-col gap-2 rounded-2xl border p-4">
      <EloTeamLine side="A" players={m.sideA} />
      <EloTeamLine side="B" players={m.sideB} />
    </div>
  );
}

// ─── DRAFT ─────────────────────────────────────────────────────────────────

function DraftPanel({
  m,
  ops,
  meId,
  data,
}: {
  m: EloLiveMatch;
  ops: EloMatchOps | null;
  meId: string | null;
  data: EloSnapshot;
}) {
  const { pending, run } = useEloAction();
  const router = useRouter();
  const leaveDlg = useDialog();
  const cancelDlg = useDialog();
  const mySide = sideOf(m, meId);
  const ready = m.consentA && m.consentB;
  const can = ops?.can;
  const session = data.session;
  const preview = useMemo(() => {
    if (!session) return null;
    try {
      return previewMatchup(m.sideA, m.sideB, session.params, m.rated ? (m.prospective?.multiplier ?? 1) : 0);
    } catch {
      return null; // never break the page over an informative preview
    }
  }, [m.sideA, m.sideB, m.rated, m.prospective, session]);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <SideCard side="A" players={m.sideA} meId={meId} consent={m.consentA} />
        <SideCard side="B" players={m.sideB} meId={meId} consent={m.consentB} />
      </div>
      {m.expiresAt && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Hourglass className="size-4 shrink-0" aria-hidden="true" />
          Tisch reserviert bis {clockTime(m.expiresAt)}. Ohne Start wird er danach wieder frei.
        </p>
      )}
      <section aria-label="Aktionen" className="flex flex-col gap-2">
        {can?.consent && ops && mySide && (
          <div className="border-warning/70 bg-warning/5 flex flex-col gap-3 rounded-2xl border-2 p-4">
            <p className="font-display text-2xl leading-tight">Spielt Team {mySide} so mit?</p>
            <p className="text-foreground/85">
              {teamLabel(m.sideA.map((p) => p.displayName))} gegen{" "}
              {teamLabel(m.sideB.map((p) => p.displayName))},{" "}
              {m.rated ? "um Elo-Punkte" : "als Freundschaftsspiel ohne Elo"}.
            </p>
            <Button
              size="xl"
              variant="success"
              className="w-full"
              disabled={pending != null}
              onClick={() =>
                run("consent", () => consentEloRosterAction({ matchId: m.id, rosterHash: ops.rosterHash }), {
                  successToast: `Team ${mySide} ist bereit`,
                })
              }
            >
              <ThumbsUp aria-hidden="true" /> Ja, wir spielen mit
            </Button>
          </div>
        )}
        {can?.start && ops ? (
          <Button
            size="xl"
            variant="accent"
            className="w-full"
            disabled={pending != null}
            onClick={() =>
              run("start", () => startEloMatchAction({ matchId: m.id, expectedVersion: ops.version }))
            }
          >
            <Play aria-hidden="true" /> Spiel starten
          </Button>
        ) : mySide && !can?.consent ? (
          <p className="bg-muted/60 text-primary flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-center font-semibold">
            <Hourglass className="size-5 shrink-0" aria-hidden="true" />
            {ready
              ? "Beide Teams bereit"
              : `Wartet auf Team ${(mySide === "A" ? m.consentB : m.consentA) ? mySide : other(mySide)}: Handy rüberreichen oder kurz rufen`}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          {can?.editRoster && (
            <Link
              href={`/elo/play?edit=${m.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "sm:flex-1")}
            >
              <Pencil aria-hidden="true" /> Aufstellung ändern
            </Link>
          )}
          {can?.leave && (
            <Button variant="ghost" size="lg" className="sm:flex-1" onClick={leaveDlg.show}>
              <LogOut aria-hidden="true" /> Ich spiele nicht mit
            </Button>
          )}
          {can?.cancel && (
            <Button variant="destructive" size="lg" className="sm:flex-1" onClick={cancelDlg.show}>
              <Ban aria-hidden="true" /> Match abbrechen
            </Button>
          )}
        </div>
      </section>
      {preview && (
        <section aria-labelledby="stake" className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
          <h2 id="stake" className="text-2xl leading-none">
            Was steht auf dem Spiel?
          </h2>
          <MatchupPreviewPanel
            preview={preview}
            sizeA={m.sideA.length}
            sizeB={m.sideB.length}
            rated={m.rated}
            priorCount={m.prospective?.priorCount ?? 0}
            pendingSamePairing={false}
          />
        </section>
      )}
      <ConfirmDialog
        open={leaveDlg.open}
        onOpenChange={leaveDlg.setOpen}
        title="Aus dem Match aussteigen?"
        description="Die anderen müssen die neue Aufstellung nochmals bestätigen. Ist dein Team danach leer, wird das Match abgebrochen."
        confirmLabel="Aussteigen"
        tone="destructive"
        busy={pending != null}
        onConfirm={async () => {
          const out = await run("leave", () => leaveEloMatchAction({ matchId: m.id }), {
            successToast: "Du bist ausgestiegen",
          });
          if (out.kind === "ok") {
            leaveDlg.hide();
            router.push("/");
          }
        }}
      />
      <ConfirmDialog
        open={cancelDlg.open}
        onOpenChange={cancelDlg.setOpen}
        title="Match abbrechen?"
        description="Die Aufstellung wird verworfen und der Tisch ist sofort wieder frei."
        confirmLabel="Match abbrechen"
        tone="destructive"
        busy={pending != null}
        onConfirm={async () => {
          const out = await run(
            "cancel",
            () => cancelEloMatchAction({ matchId: m.id, expectedVersion: ops?.version }),
            { successToast: "Match abgebrochen" },
          );
          if (out.kind === "ok") {
            cancelDlg.hide();
            router.push("/");
          }
        }}
      />
    </>
  );
}

// ─── IN_PROGRESS ───────────────────────────────────────────────────────────

function RunningPanel({
  m,
  ops,
  clockOffsetMs,
  reminder,
}: {
  m: EloLiveMatch;
  ops: EloMatchOps | null;
  clockOffsetMs: number;
  reminder: number | null;
}) {
  const { pending, run, runKeyed } = useEloAction();
  const [entering, setEntering] = useState(false);
  const paused = m.timer?.pausedAt != null;
  const can = ops?.can;
  if (entering && can?.submitResult && ops) {
    return (
      <ResultEntry
        sideA={m.sideA}
        sideB={m.sideB}
        submitLabel="Resultat eintragen"
        busy={pending != null}
        onCancel={() => setEntering(false)}
        onSubmit={async (r) => {
          const out = await runKeyed(m.id, "elo-submit", ops.version, (idempotencyKey) =>
            submitEloResultAction({ matchId: m.id, expectedVersion: ops.version, idempotencyKey, ...r }),
          );
          if (out.kind === "ok" || out.kind === "error") setEntering(false);
        }}
      />
    );
  }
  return (
    <>
      <Compact m={m} />
      <section aria-label="Spieluhr" className="flex flex-col items-center gap-4 py-2">
        {m.timer && (
          <ClientOnly fallback={<div className="h-24" aria-hidden="true" />}>
            <Stopwatch timer={m.timer} clockOffsetMs={clockOffsetMs} reminderMinutes={reminder} size="lg" />
          </ClientOnly>
        )}
        <p className="text-muted-foreground text-sm">
          Kein Zeitlimit: Gespielt wird, bis ein Team keine Becher mehr hat.
        </p>
      </section>
      {(can?.pause || can?.resume || can?.submitResult) && ops && (
        <section aria-label="Aktionen" className="flex flex-col gap-2">
          {(can.pause || can.resume) && (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={pending != null}
              onClick={() =>
                run(paused ? "resume" : "pause", () =>
                  (paused ? resumeEloMatchAction : pauseEloMatchAction)({
                    matchId: m.id,
                    expectedVersion: ops.version,
                  }),
                )
              }
            >
              {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {paused ? "Weiterspielen" : "Pause"}
            </Button>
          )}
          {can.submitResult && (
            <Button size="xl" className="w-full" onClick={() => setEntering(true)}>
              <Flag aria-hidden="true" /> Match beenden
            </Button>
          )}
        </section>
      )}
    </>
  );
}

// ─── AWAITING_CONFIRMATION / DISPUTED ──────────────────────────────────────

function ReportCard({ m }: { m: EloLiveMatch }) {
  const r = m.report;
  if (!r) return null;
  return (
    <section
      aria-label="Gemeldetes Resultat"
      className={cn(
        "flex flex-col gap-1 rounded-2xl border-2 p-4",
        r.winnerSide === "A" ? "border-team-home/70 bg-team-home/5" : "border-team-away/70 bg-team-away/5",
      )}
    >
      <p className="text-muted-foreground text-sm font-semibold">
        Gemeldet{r.byName ? ` von ${r.byName}` : ""}
        {r.side ? ` (Team ${r.side})` : ""}
        {r.at ? ` um ${clockTime(r.at)}` : ""}
      </p>
      <p className="font-display text-3xl leading-tight">Team {r.winnerSide} gewinnt</p>
      <p className="text-foreground/85 break-words">
        {teamLabel((r.winnerSide === "A" ? m.sideA : m.sideB).map((p) => p.displayName))}
      </p>
      <p className="text-muted-foreground text-sm">
        {eloEndTypeLabel[r.endType]}
        {(r.cupsRemainingA != null || r.cupsRemainingB != null) &&
          ` · Becher übrig: A ${r.cupsRemainingA ?? "–"}, B ${r.cupsRemainingB ?? "–"}`}
      </p>
    </section>
  );
}

function PendingPanel({
  m,
  ops,
  meId,
  policy,
}: {
  m: EloLiveMatch;
  ops: EloMatchOps | null;
  meId: string | null;
  policy: string | null;
}) {
  const { pending, runKeyed } = useEloAction();
  const [amending, setAmending] = useState(false);
  const disputeDlg = useDialog();
  const [note, setNote] = useState("");
  const can = ops?.can;
  const mySide = sideOf(m, meId);
  const submitted = m.report?.side ?? null;

  if (amending && can?.amendResult && ops && m.report) {
    return (
      <ResultEntry
        sideA={m.sideA}
        sideB={m.sideB}
        initial={{
          winnerSide: m.report.winnerSide,
          endType: m.report.endType,
          cupsRemainingA: m.report.cupsRemainingA,
          cupsRemainingB: m.report.cupsRemainingB,
        }}
        title="Meldung korrigieren: Wer hat gewonnen?"
        submitLabel="Korrektur senden"
        busy={pending != null}
        onCancel={() => setAmending(false)}
        onSubmit={async (r) => {
          const out = await runKeyed(
            m.id,
            "elo-submit",
            ops.version,
            (idempotencyKey) =>
              submitEloResultAction({ matchId: m.id, expectedVersion: ops.version, idempotencyKey, ...r }),
            { successToast: "Meldung korrigiert" },
          );
          if (out.kind === "ok" || out.kind === "error") setAmending(false);
        }}
      />
    );
  }

  return (
    <>
      <Compact m={m} />
      <ReportCard m={m} />
      {can?.confirmResult && ops ? (
        <section aria-label="Resultat bestätigen" className="flex flex-col gap-2">
          <p className="font-display text-2xl leading-tight">Stimmt das?</p>
          <Button
            size="xl"
            variant="success"
            className="w-full"
            disabled={pending != null}
            onClick={() =>
              runKeyed(m.id, "elo-confirm", ops.resultVersion, (idempotencyKey) =>
                confirmEloResultAction({ matchId: m.id, resultVersion: ops.resultVersion, idempotencyKey }),
              )
            }
          >
            <ThumbsUp aria-hidden="true" /> Ja, bestätigen
          </Button>
          {can.disputeResult && (
            <Button variant="destructive" size="lg" className="w-full" onClick={disputeDlg.show}>
              <ThumbsDown aria-hidden="true" /> Nein, Einspruch
            </Button>
          )}
        </section>
      ) : (
        <p className="bg-muted/60 text-primary flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-center font-semibold">
          <Hourglass className="size-5 shrink-0" aria-hidden="true" />
          {policy === "REFEREE_ONLY"
            ? "Wartet auf die Bestätigung durch die Schiri"
            : `Wartet auf die Bestätigung durch Team ${submitted ? other(submitted) : "?"}`}
        </p>
      )}
      {can?.disputeResult && !can.confirmResult && ops && (
        <Button variant="destructive" size="lg" className="w-full" onClick={disputeDlg.show}>
          <ThumbsDown aria-hidden="true" /> Einspruch erheben
        </Button>
      )}
      {can?.amendResult && mySide === submitted && (
        <Button variant="outline" size="lg" className="w-full" onClick={() => setAmending(true)}>
          <Pencil aria-hidden="true" /> Meldung korrigieren
        </Button>
      )}
      {ops && (
        <ConfirmDialog
          open={disputeDlg.open}
          onOpenChange={disputeDlg.setOpen}
          title="Einspruch erheben?"
          description="Das Match wird nicht gewertet, bis die Schiri entschieden hat."
          confirmLabel="Einspruch erheben"
          tone="destructive"
          busy={pending != null}
          onConfirm={async () => {
            const out = await runKeyed(
              m.id,
              "elo-dispute",
              ops.resultVersion,
              (idempotencyKey) =>
                disputeEloResultAction({
                  matchId: m.id,
                  resultVersion: ops.resultVersion,
                  note: note.trim() || undefined,
                  idempotencyKey,
                }),
              { successToast: "Einspruch erfasst. Die Schiri entscheidet." },
            );
            if (out.kind === "ok") disputeDlg.hide();
          }}
        >
          <ReasonField
            id="elo-dispute-note"
            value={note}
            onChange={setNote}
            min={0}
            max={300}
            label="Was stimmt nicht? (freiwillig)"
            placeholder="z. B. wir haben gewonnen"
          />
        </ConfirmDialog>
      )}
    </>
  );
}

function DisputedPanel({ m }: { m: EloLiveMatch }) {
  return (
    <>
      <Compact m={m} />
      <ReportCard m={m} />
      <section
        role="status"
        className="border-destructive/60 bg-destructive/10 flex items-start gap-3 rounded-2xl border-2 p-4"
      >
        <ShieldAlert className="text-destructive mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight">
            Einspruch{m.dispute?.byName ? ` von ${m.dispute.byName}` : ""}
          </p>
          {m.dispute?.note && <p className="break-words">«{m.dispute.note}»</p>}
          <p className="text-foreground/85 text-sm">
            Die Schiri entscheidet. Bis dahin zählt das Match nicht.
          </p>
        </div>
      </section>
    </>
  );
}

function EndedNotice({ m, detail }: { m: EloLiveMatch; detail: EloMatchDetail }) {
  const voided = m.status === "VOIDED";
  const reason = detail.cancelReason === "EXPIRED" ? "Die Reservation ist abgelaufen." : detail.cancelReason;
  return (
    <>
      <Compact m={m} />
      <section role="status" className="bg-muted/40 flex items-start gap-3 rounded-2xl border p-4">
        {voided ? (
          <CircleSlash className="text-muted-foreground mt-0.5 size-6 shrink-0" aria-hidden="true" />
        ) : (
          <Ban className="text-muted-foreground mt-0.5 size-6 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight">{voided ? "Annulliert" : "Abgebrochen"}</p>
          <p className="text-foreground/85">Dieses Match zählt nicht für Elo.</p>
          {reason && <p className="text-muted-foreground text-sm break-words">Grund: {reason}</p>}
        </div>
      </section>
    </>
  );
}

// ─── Page body ─────────────────────────────────────────────────────────────

function Body({
  m,
  detail,
  data,
  ops,
  clockOffsetMs,
}: {
  m: EloLiveMatch;
  detail: EloMatchDetail;
  data: EloSnapshot | null;
  ops: EloMatchOps | null;
  clockOffsetMs: number;
}) {
  const meId = data?.me?.userId ?? null;
  const session = data?.session ?? null;
  const canPlayAgain =
    !!data?.me && data.gameMode === "ELO" && session?.status === "OPEN" && !data.me.liveMatchId;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        kicker={m.rated ? "Elo-Match" : "Freundschaftsspiel"}
        title={`Tisch ${m.tableNumber}`}
        action={<EloStatusPill status={eloPillKey(m)} size="lg" />}
      />
      {m.status === "DRAFT" && data && <DraftPanel m={m} ops={ops} meId={meId} data={data} />}
      {m.status === "IN_PROGRESS" && (
        <RunningPanel
          m={m}
          ops={ops}
          clockOffsetMs={clockOffsetMs}
          reminder={session?.settings.softReminderMinutes ?? null}
        />
      )}
      {m.status === "AWAITING_CONFIRMATION" && (
        <PendingPanel m={m} ops={ops} meId={meId} policy={session?.settings.resultPolicy ?? null} />
      )}
      {m.status === "DISPUTED" && <DisputedPanel m={m} />}
      {m.status === "COMPLETED" && (
        <CompletedResult
          m={m}
          detail={detail}
          meId={meId}
          leaderboard={data?.leaderboard ?? []}
          canPlayAgain={canPlayAgain}
        />
      )}
      {(m.status === "CANCELLED" || m.status === "VOIDED" || (m.status === "DRAFT" && !data)) && (
        <EndedNotice m={m} detail={detail} />
      )}
      {ops && data && <StaffPanel m={m} ops={ops} />}
      <MatchTimeline events={detail.events} />
      <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "self-start")}>
        <ArrowLeft aria-hidden="true" /> Zur Übersicht
      </Link>
    </div>
  );
}

function LiveBody({ detail }: { detail: EloMatchDetail }) {
  const { data, connection, clockOffsetMs } = useEloLive();
  const router = useRouter();
  const live =
    [...data.liveMatches, ...data.pendingMatches, ...data.recentMatches].find((x) => x.id === detail.id) ??
    null;
  const ops = data.matchOps?.[detail.id] ?? null;

  // Reload the server part (timeline, final rating changes, reasons) when this match changes state
  // or leaves the live lists (cancelled, expired, voided).
  const key = live
    ? [
        live.status,
        live.timer?.pausedAt ?? "",
        live.consentA,
        live.consentB,
        live.report?.at ?? "",
        live.sideA.length,
        live.sideB.length,
      ].join("|")
    : "gone";
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    router.refresh();
  }, [key, router]);

  // An open match that left the live lists was just cancelled, expired or voided: the stored
  // detail still shows the old state, so wait for the refresh instead of offering stale actions.
  if (!live && OPEN_STATUSES.includes(detail.status)) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle kicker="Elo-Match" title={`Tisch ${detail.tableNumber}`} />
        <p role="status" className="text-muted-foreground flex items-center gap-2">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> Das Match hat sich geändert. Lade
          neu …
        </p>
      </div>
    );
  }
  const m = live ?? matchFromDetail(detail);
  return (
    <>
      {connection && connection !== "online" && <ConnectionBadge state={connection} className="self-start" />}
      <Body m={m} detail={detail} data={data} ops={ops} clockOffsetMs={clockOffsetMs} />
    </>
  );
}

/** /elo/matches/[id]: live for the current event, otherwise the stored story of the match. */
export function EloMatchView({
  detail,
  live,
}: {
  detail: EloMatchDetail;
  live: { mode: EloLiveMode; snapshot: EloSnapshot } | null;
}) {
  if (!live) {
    return <Body m={matchFromDetail(detail)} detail={detail} data={null} ops={null} clockOffsetMs={0} />;
  }
  return (
    <EloLiveProvider mode={live.mode} initial={live.snapshot}>
      <LiveBody detail={detail} />
    </EloLiveProvider>
  );
}
