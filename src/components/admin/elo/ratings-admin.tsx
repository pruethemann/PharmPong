"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, RefreshCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  recalculateEloAction,
  updateEloParamsAction,
  verifyEloRatingsAction,
} from "@/server/actions/elo-admin";
import { ELO_RECALC_CONFIRM_TEXT } from "@/server/domain/elo/config";
import type { RatingVerification } from "@/server/services/elo-ratings";
import type { EloRunRow, EloSessionAdmin } from "@/server/services/elo-read";
import { clockTime } from "@/lib/elo-format";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, ReasonField, TypedConfirmField, aria, reasonOk } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import type { EloSnapshot } from "@/components/elo/elo-live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Runner = ReturnType<typeof useAdminAction>;

const RUN_REASON: Record<string, string> = {
  INITIAL: "Start",
  CONFIG_CHANGE: "Parameter geändert",
  CORRECTION: "Korrektur",
  ROSTER_CORRECTION: "Aufstellung korrigiert",
  RATED_CHANGED: "Wertung umgestellt",
  VOID: "Annulliert",
  MANUAL: "Neu berechnet",
};

/** Tolerance for "Prüfen": below it the stored ratings equal a fresh replay. */
const TOLERANCE = 1e-9;

function parseMultipliers(raw: string): number[] | null {
  const parts = raw
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  if (parts.length === 0 || parts.length > 10 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
    return null;
  return parts;
}

function ParamsForm({
  session,
  data,
  runner,
}: {
  session: EloSessionAdmin;
  data: EloSnapshot;
  runner: Runner;
}) {
  const p = data.session!.params;
  const [k, setK] = useState(String(p.kFactor));
  const [d, setD] = useState(String(p.ratingScale));
  const [initial, setInitial] = useState(String(p.initialRating));
  const [mult, setMult] = useState(p.repeatMultipliers.join(", "));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const multipliers = parseMultipliers(mult);
  const params =
    multipliers && [k, d, initial].every((x) => Number.isFinite(Number(x)) && x.trim() !== "")
      ? {
          kFactor: Number(k),
          ratingScale: Number(d),
          initialRating: Number(initial),
          repeatMultipliers: multipliers,
        }
      : null;
  const rated = data.stats.rated > 0;
  const ref = { sessionId: session.id, expectedConfigVersion: session.configVersion };
  const submit = async (extra: { reason?: string; confirmText?: string }) => {
    if (!params) return;
    const res = await runner.run("params", () => updateEloParamsAction({ ...ref, params, ...extra }), {
      success: (r) =>
        r.changed ? `Parameter übernommen. Neue Berechnung Nr. ${r.runRevision}.` : "Keine Änderung.",
    });
    if (res?.ok) setConfirmOpen(false);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (rated) {
          setTyped("");
          setReason("");
          setConfirmOpen(true);
        } else void submit({});
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField id="p-k" label="K-Faktor (max. Punkte pro Team)" hint="0 < K ≤ 100, Standard 24">
          <Input
            {...aria("p-k", null, true)}
            inputMode="decimal"
            value={k}
            onChange={(e) => setK(e.target.value)}
          />
        </AdminField>
        <AdminField id="p-d" label="Skala D" hint="10–1000, Standard 100 (klassisch Schach: 400)">
          <Input
            {...aria("p-d", null, true)}
            inputMode="decimal"
            value={d}
            onChange={(e) => setD(e.target.value)}
          />
        </AdminField>
        <AdminField id="p-i" label="Startwert" hint="0–10000, Standard 100">
          <Input
            {...aria("p-i", null, true)}
            inputMode="decimal"
            value={initial}
            onChange={(e) => setInitial(e.target.value)}
          />
        </AdminField>
        <AdminField
          id="p-m"
          label="Wiederholungs-Faktoren"
          hint="Pro Begegnung (1., 2., …), der letzte Wert gilt danach. 0–1 mit Dezimalpunkt, z. B. 1, 1, 0.5, 0. Aus: 1"
          error={multipliers ? null : "Liste mit 1–10 Zahlen zwischen 0 und 1."}
        >
          <Input
            {...aria("p-m", multipliers ? null : "invalid", true)}
            value={mult}
            onChange={(e) => setMult(e.target.value)}
          />
        </AdminField>
      </div>
      <p className="text-muted-foreground text-sm">
        {rated
          ? "Achtung: Es gibt gewertete Matches. Eine Änderung berechnet alle Elo-Werte neu (neue Berechnung, Bestätigung nötig)."
          : "Noch keine gewerteten Matches: Änderungen gelten sofort."}
      </p>
      <Button
        type="submit"
        variant="outline"
        size="lg"
        disabled={!params || runner.pending !== null}
        className="self-start"
      >
        <Calculator aria-hidden="true" /> Parameter übernehmen
      </Button>
      <AdminDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Parameter ändern und neu berechnen?"
        tone="destructive"
        description="Alle Matches dieser Runde werden mit den neuen Parametern neu gerechnet. Ranglisten können sich ändern."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={
                runner.pending !== null || typed.trim() !== ELO_RECALC_CONFIRM_TEXT || !reasonOk(reason, 5)
              }
              onClick={() => void submit({ reason, confirmText: typed })}
            >
              Ändern und neu berechnen
            </Button>
          </>
        }
      >
        <ReasonField
          id="params-reason"
          value={reason}
          onChange={setReason}
          min={5}
          placeholder="z. B. K zu hoch für kleine Runde"
        />
        <TypedConfirmField
          id="params-confirm"
          expected={ELO_RECALC_CONFIRM_TEXT}
          value={typed}
          onChange={setTyped}
        />
      </AdminDialog>
    </form>
  );
}

/** Calculation runs, the "Prüfen" dry run, manual recalculation and the rating parameters. */
export function RatingsAdmin({
  session,
  data,
  runs,
  runner,
}: {
  session: EloSessionAdmin;
  data: EloSnapshot;
  runs: EloRunRow[];
  runner: Runner;
}) {
  const [check, setCheck] = useState<RatingVerification | null>(null);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const active = runs.find((r) => r.supersededAt == null) ?? null;
  const ok = check ? check.maxDeviation <= TOLERANCE && check.mismatchedUserIds.length === 0 : null;

  return (
    <section aria-labelledby="ratings-title" className="flex flex-col gap-4">
      <h2 id="ratings-title" className="text-2xl leading-none">
        Berechnung
      </h2>
      {active && (
        <p className="text-muted-foreground text-sm">
          Aktive Berechnung Nr. <strong className="text-foreground">{active.revision}</strong> · K{" "}
          {active.kFactor} · D {active.ratingScale} · Start {active.initialRating} · Wiederholung{" "}
          {active.repeatMultipliers.join(" / ")} · {active.algorithmVersion} · {active.runtime}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          size="lg"
          disabled={runner.pending !== null}
          onClick={() =>
            runner.run("verify", () => verifyEloRatingsAction({ sessionId: session.id }), {
              onOk: (r) => setCheck(r),
            })
          }
        >
          <ShieldCheck aria-hidden="true" /> Prüfen (ohne Änderung)
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={runner.pending !== null}
          onClick={() => {
            setTyped("");
            setReason("");
            setRecalcOpen(true);
          }}
        >
          <RefreshCcw aria-hidden="true" /> Neu berechnen
        </Button>
      </div>
      {check && (
        <p
          role="status"
          className={
            ok
              ? "border-success/60 bg-success/10 flex items-start gap-2 rounded-xl border p-3"
              : "border-destructive/60 bg-destructive/10 flex items-start gap-2 rounded-xl border p-3"
          }
        >
          {ok ? (
            <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {ok ? "Alles stimmt: " : "Abweichung gefunden: "}
            {check.matches} Matches, {check.players} Spieler:innen, grösste Abweichung{" "}
            {check.maxDeviation.toExponential(1)}, Summenfehler {check.conservationError.toExponential(1)}.
            {!ok && " «Neu berechnen» stellt den korrekten Stand her."}
          </span>
        </p>
      )}
      <details className="bg-card rounded-2xl border p-4">
        <summary className="min-h-10 cursor-pointer font-semibold">
          Verlauf der Berechnungen ({runs.length})
        </summary>
        <ol className="mt-3 flex flex-col gap-2 text-sm">
          {runs.map((r) => (
            <li key={r.id} className="border-b pb-2 last:border-b-0">
              <span className="font-semibold">Nr. {r.revision}</span> · {RUN_REASON[r.reason] ?? r.reason} ·{" "}
              {clockTime(r.createdAt)}
              {r.triggeredBy && ` · ${r.triggeredBy}`} · {r.changes} Änderungen
              {r.supersededAt == null ? " · aktiv" : ""}
              {r.note && <span className="text-muted-foreground block">«{r.note}»</span>}
            </li>
          ))}
        </ol>
      </details>
      {session.status !== "CLOSED" && data.session && (
        <details className="bg-card rounded-2xl border p-4">
          <summary className="min-h-10 cursor-pointer font-semibold">Wertungsparameter ändern</summary>
          <div className="mt-3">
            <ParamsForm session={session} data={data} runner={runner} />
          </div>
        </details>
      )}
      <AdminDialog
        open={recalcOpen}
        onOpenChange={setRecalcOpen}
        title="Elo neu berechnen?"
        description="Alle bestätigten Matches werden in Bestätigungsreihenfolge neu gerechnet (neue Berechnung, die alte bleibt im Verlauf)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecalcOpen(false)}>
              Zurück
            </Button>
            <Button
              disabled={
                runner.pending !== null || typed.trim() !== ELO_RECALC_CONFIRM_TEXT || !reasonOk(reason, 5)
              }
              onClick={async () => {
                const res = await runner.run(
                  "recalc",
                  () => recalculateEloAction({ sessionId: session.id, reason, confirmText: typed }),
                  {
                    success: (r) =>
                      r.unchanged
                        ? `Neu berechnet (Nr. ${r.runRevision}): keine Änderung.`
                        : `Neu berechnet (Nr. ${r.runRevision}).`,
                  },
                );
                if (res?.ok) setRecalcOpen(false);
              }}
            >
              Neu berechnen
            </Button>
          </>
        }
      >
        <ReasonField
          id="recalc-reason"
          value={reason}
          onChange={setReason}
          min={5}
          placeholder="z. B. Prüfen zeigte Abweichung"
        />
        <TypedConfirmField
          id="recalc-confirm"
          expected={ELO_RECALC_CONFIRM_TEXT}
          value={typed}
          onChange={setTyped}
        />
      </AdminDialog>
    </section>
  );
}
