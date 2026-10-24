"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, OctagonX, RotateCcw } from "lucide-react";
import { StatusPill } from "@/components/pp/status-pill";
import { Button } from "@/components/ui/button";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { ReasonField, TypedConfirmField, reasonOk } from "@/components/admin/fields";
import type { TeamIndex } from "@/components/admin/live-bits";
import { endTypeLabel, tournamentStatusLabel, type TournamentStatusKey } from "@/lib/i18n/de";
import type { AuthedSnapshot } from "@/lib/live-types";
import type { AdminResultDraft } from "@/lib/admin-result";
import { executeRecoveryAction, planRecoveryAction } from "@/server/actions/matches";
import type { RecoveryOutcome, RecoveryPlan } from "@/server/services/corrections";

type Step = "plan" | "confirm" | "done";

/** Statuses where a voided match is currently occupying a table (clock/table get cleared). */
const AT_TABLE = new Set(["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"]);

export type RecoveryRequest = {
  matchId: string;
  code: string;
  expectedVersion: number;
  reason: string;
  newResult: Omit<AdminResultDraft, "homeTeamId" | "awayTeamId">;
  cause: "DOWNSTREAM_STARTED" | "UNRESOLVED_TIE";
};

/**
 * Recovery wizard: plan (affected matches) → typed confirmation + reason → execute → summary.
 * Nothing is changed before the final, explicitly confirmed step.
 */
export function RecoveryWizard({
  request,
  onClose,
  snap,
  teams,
  online,
  refresh,
}: {
  request: RecoveryRequest | null;
  onClose: () => void;
  snap: AuthedSnapshot;
  teams: TeamIndex;
  online: boolean;
  refresh: () => void;
}) {
  const [step, setStep] = useState<Step>("plan");
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RecoveryOutcome | null>(null);
  // Bumped after STALE_VERSION: reloads the plan; execute then uses the live version.
  const [planNonce, setPlanNonce] = useState(0);
  const [useLiveVersion, setUseLiveVersion] = useState(false);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    // Reset the wizard for a new request, then load the exact plan (with the new result).
    /* eslint-disable react-hooks/set-state-in-effect -- reset on a new wizard request */
    setStep("plan");
    setPlan(null);
    setPlanError(null);
    setConfirmText("");
    setReason(request.reason);
    setError(null);
    setOutcome(null);
    setUseLiveVersion(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    planRecoveryAction({ matchId: request.matchId, newResult: request.newResult })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setPlan(res.data);
        else setPlanError(res.message);
      })
      .catch(() => !cancelled && setPlanError("Keine Verbindung. Plan konnte nicht geladen werden."));
    return () => {
      cancelled = true;
    };
  }, [request]);

  // Reload only the plan (keep reason/confirmation) after the data changed underneath.
  useEffect(() => {
    if (!request || planNonce === 0) return;
    let cancelled = false;
    planRecoveryAction({ matchId: request.matchId, newResult: request.newResult })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setPlan(res.data);
        else setPlanError(res.message);
      })
      .catch(() => !cancelled && setPlanError("Keine Verbindung. Plan konnte nicht geladen werden."));
    return () => {
      cancelled = true;
    };
  }, [planNonce, request]);

  if (!request) return null;
  const expected = plan?.confirmText ?? `${request.code} ZURÜCKSETZEN`;
  const teamName = (t: { name: string } | null) => t?.name ?? "offen";

  async function execute() {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const liveVersion = snap.matchOps?.[request.matchId]?.version;
      const res = await executeRecoveryAction({
        matchId: request.matchId,
        expectedVersion: useLiveVersion && liveVersion != null ? liveVersion : request.expectedVersion,
        reason: reason.trim(),
        confirmText: confirmText.trim(),
        newResult: request.newResult,
      });
      if (res.ok) {
        setOutcome(res.data);
        setStep("done");
        refresh();
      } else if (res.code === "STALE_VERSION") {
        // Something changed meanwhile: reload data and plan, let the admin review it again.
        refresh();
        setUseLiveVersion(true);
        setPlan(null);
        setPlanError(null);
        setStep("plan");
        setPlanNonce((n) => n + 1);
        setError(
          "Die Daten haben sich inzwischen geändert. Die Auswirkungen wurden neu berechnet: bitte prüfen und erneut bestätigen.",
        );
      } else {
        setError(res.message);
      }
    } catch {
      setError("Keine Verbindung zum Server. Es wurde nichts geändert.");
    } finally {
      setBusy(false);
    }
  }

  const r = request.newResult;
  const winner = teams.get(r.winnerTeamId)?.name ?? "?";

  return (
    <AdminDialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      tone={step === "done" ? "default" : "destructive"}
      className="sm:max-w-2xl"
      title={step === "done" ? "Wiederherstellung abgeschlossen" : `Wiederherstellung ${request.code}`}
      description={
        step === "done"
          ? undefined
          : request.cause === "UNRESOLVED_TIE"
            ? "Die Korrektur erzeugt einen offenen Gleichstand in der Gruppe. Die betroffenen K.-o.-Spiele müssen zurückgesetzt werden."
            : "Folgespiele haben bereits begonnen. Für die Korrektur müssen sie zurückgesetzt werden."
      }
      footer={
        step === "plan" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Schliessen
            </Button>
            <Button variant="destructive" disabled={!plan} onClick={() => setStep("confirm")}>
              Weiter zur Bestätigung
            </Button>
          </>
        ) : step === "confirm" ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep("plan")}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={busy || !online || confirmText.trim() !== expected || !reasonOk(reason, 5)}
              onClick={() => void execute()}
            >
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {busy ? "Wird ausgeführt …" : "Zurücksetzen & korrigieren"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fertig</Button>
        )
      }
    >
      <ol className="text-muted-foreground flex gap-2 text-sm" aria-label="Schritte">
        {(["plan", "confirm", "done"] as const).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={step === s ? "text-foreground font-semibold" : undefined}
          >
            {i + 1}. {s === "plan" ? "Auswirkungen" : s === "confirm" ? "Bestätigen" : "Ergebnis"}
            {i < 2 && <span aria-hidden="true"> ›</span>}
          </li>
        ))}
      </ol>

      <div className="bg-muted/40 rounded-xl border p-3 text-sm">
        <p className="text-muted-foreground">Neues Resultat für {request.code}</p>
        <p className="font-semibold">
          Sieger {winner} · {r.homeCupsRemaining}:{r.awayCupsRemaining} · {endTypeLabel[r.endType]}
        </p>
      </div>

      {step === "plan" && (
        <div aria-live="polite" className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-warning flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          {planError ? (
            <p className="text-destructive flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {planError}
            </p>
          ) : !plan ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Berechne betroffene Spiele …
            </p>
          ) : (
            <>
              {plan.resetsKnockout && (
                <p className="border-destructive/60 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border p-3 font-semibold">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Die gesamte K.-o.-Phase wird zurückgesetzt. Das Turnier kehrt in die Gruppenphase zurück,
                  damit der Ranking-Shootout erfasst werden kann.
                </p>
              )}
              {(() => {
                const atTable = plan.affected.filter((a) => AT_TABLE.has(a.status));
                if (atTable.length === 0) return null;
                return (
                  <p className="border-destructive/60 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border p-3 font-semibold">
                    <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {atTable.length === 1
                      ? "Ein Spiel ist gerade an einem Tisch aktiv und wird sofort abgebrochen (Tisch wird frei, Uhr gelöscht). Vorher die Schiedsrichter:in informieren."
                      : `${atTable.length} Spiele sind gerade an Tischen aktiv und werden sofort abgebrochen (Tische werden frei, Uhren gelöscht). Vorher die Schiedsrichter:innen informieren.`}
                  </p>
                );
              })()}
              <p className="font-semibold">
                {plan.affected.length === 0
                  ? "Keine Folgespiele betroffen."
                  : plan.affected.length === 1
                    ? "1 Spiel wird zurückgesetzt:"
                    : `${plan.affected.length} Spiele werden zurückgesetzt:`}
              </p>
              <ul className="flex flex-col gap-2">
                {plan.affected.map((a) => {
                  const live = snap.matches.find((m) => m.code === a.code);
                  const res = live?.result;
                  const atTable = AT_TABLE.has(a.status);
                  return (
                    <li key={a.code} className="bg-card flex flex-col gap-1.5 rounded-xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-display text-xl leading-none">{a.code}</span>
                        <StatusPill status={a.status} size="sm" />
                      </div>
                      <p className="truncate text-sm">
                        {teamName(a.homeTeam)} vs {teamName(a.awayTeam)}
                      </p>
                      {atTable && (
                        <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
                          <OctagonX className="size-4 shrink-0" aria-hidden="true" />
                          {a.status === "ASSIGNED"
                            ? `Zuweisung${live?.tableNumber != null ? ` an Tisch ${live.tableNumber}` : ""} wird aufgehoben`
                            : `Laufendes Spiel${live?.tableNumber != null ? ` an Tisch ${live.tableNumber}` : ""} wird abgebrochen`}
                          {a.status === "AWAITING_CONFIRMATION" ? " (Resultatvorschlag verfällt)" : ""}
                        </p>
                      )}
                      {a.hasResult && (
                        <p className="text-destructive text-sm font-semibold">
                          Resultat wird annulliert
                          {res
                            ? `: Sieger ${teams.get(res.winnerTeamId)?.name ?? "?"} · ${res.homeCupsRemaining}:${res.awayCupsRemaining}`
                            : ""}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground text-sm">
                Die Historie bleibt vollständig im Audit-Log. Danach werden die Paarungen neu gesetzt.
              </p>
            </>
          )}
        </div>
      )}

      {step === "confirm" && (
        <div className="flex flex-col gap-4">
          <ReasonField id="recovery-reason" value={reason} onChange={setReason} min={5} />
          <TypedConfirmField
            id="recovery-confirm"
            expected={expected}
            value={confirmText}
            onChange={setConfirmText}
          />
          {error && (
            <p role="alert" className="text-destructive flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      )}

      {step === "done" && outcome && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-success flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="size-5" aria-hidden="true" /> Resultat von {request.code} korrigiert.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Zurückgesetzt</dt>
            <dd>{outcome.voided.length ? outcome.voided.join(", ") : "–"}</dd>
            <dt className="text-muted-foreground">Neu gesetzt</dt>
            <dd>{outcome.reseeded.length ? outcome.reseeded.join(", ") : "–"}</dd>
            <dt className="text-muted-foreground">Turnierphase</dt>
            <dd>
              {tournamentStatusLabel[outcome.tournamentStatus as TournamentStatusKey] ??
                outcome.tournamentStatus}
            </dd>
          </dl>
          {outcome.tournamentStatus === "GROUP_STAGE" && (
            <p className="text-warning text-sm font-semibold">
              Nächster Schritt: Ranking-Shootout unter «Turnier» erfassen, dann die K.-o.-Phase neu starten.
            </p>
          )}
        </div>
      )}
    </AdminDialog>
  );
}
