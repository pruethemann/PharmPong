"use client";

import { useState } from "react";
import { Ban, CheckCheck, Gavel, Handshake, Trash2 } from "lucide-react";
import {
  abandonEloMatchAction,
  staffConsentEloRosterAction,
  staffFinalizeEloResultAction,
  voidEloResultAction,
} from "@/server/actions/elo";
import type { EloLiveMatch, EloMatchOps, EloSideKey } from "@/lib/elo-live-types";
import { ReasonField, reasonOk } from "@/components/admin/fields";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useDialog } from "./match-parts";
import { ResultEntry, type EloResultPayload } from "./result-entry";
import { useEloAction } from "./use-elo-action";

/**
 * Referee tools on the match page. Shown only to non-participating referees and admins (the
 * server's permission matrix decides; staff never decide a match they play in).
 */
export function StaffPanel({ m, ops }: { m: EloLiveMatch; ops: EloMatchOps }) {
  const { can } = ops;
  const { pending, run, runKeyed } = useEloAction();
  const [deciding, setDeciding] = useState(false);
  const [reason, setReason] = useState("");
  const voidDlg = useDialog();
  const abandonDlg = useDialog();
  const consentDlg = useDialog();
  const acceptDlg = useDialog();
  const [voidReason, setVoidReason] = useState("");
  const [abandonReason, setAbandonReason] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const missing: EloSideKey[] = (["A", "B"] as const).filter((s) => !(s === "A" ? m.consentA : m.consentB));
  const [consentSides, setConsentSides] = useState<EloSideKey[]>(missing);

  if (!(can.staffFinalize || can.voidResult || can.abandon || can.staffConsent)) return null;

  const resolving = m.status === "DISPUTED";
  const finalize = async (r: EloResultPayload, why: string) => {
    const out = await runKeyed(
      m.id,
      "elo-final",
      ops.version,
      (idempotencyKey) =>
        staffFinalizeEloResultAction({
          matchId: m.id,
          expectedVersion: ops.version,
          idempotencyKey,
          reason: why.trim() || undefined,
          ...r,
        }),
      { successToast: "Resultat festgelegt. Die Elo-Punkte sind verbucht." },
    );
    if (out.kind === "ok") {
      setDeciding(false);
      acceptDlg.hide();
    }
  };

  if (deciding) {
    return (
      <section className="border-primary/40 flex flex-col gap-3 rounded-2xl border-2 border-dashed p-4">
        <p className="text-primary flex items-center gap-2 text-sm font-semibold">
          <Gavel className="size-4" aria-hidden="true" /> Entscheid als Schiri
        </p>
        <ResultEntry
          sideA={m.sideA}
          sideB={m.sideB}
          initial={
            m.report
              ? {
                  winnerSide: m.report.winnerSide,
                  endType: m.report.endType,
                  cupsRemainingA: m.report.cupsRemainingA,
                  cupsRemainingB: m.report.cupsRemainingB,
                }
              : null
          }
          title={resolving ? "Wer hat wirklich gewonnen?" : "Wer hat gewonnen?"}
          submitLabel="Resultat festlegen"
          busy={pending != null}
          onCancel={() => setDeciding(false)}
          onSubmit={(r) => finalize(r, reason)}
          extraValid={!resolving || reasonOk(reason)}
          extra={
            <ReasonField
              id="elo-staff-reason"
              value={reason}
              onChange={setReason}
              min={resolving ? 3 : 0}
              label={resolving ? "Begründung (Pflicht beim Einspruch)" : "Begründung (freiwillig)"}
              placeholder="z. B. beide Teams vor Ort befragt"
            />
          }
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="staff-tools"
      className="border-primary/40 flex flex-col gap-3 rounded-2xl border-2 border-dashed p-4"
    >
      <h2 id="staff-tools" className="text-primary flex items-center gap-2 text-xl leading-none">
        <Gavel className="size-5" aria-hidden="true" /> Schiri
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {can.staffConsent && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setConsentSides(missing);
              consentDlg.show();
            }}
          >
            <Handshake aria-hidden="true" /> Zustimmung vor Ort erfassen
          </Button>
        )}
        {can.staffFinalize && m.status === "AWAITING_CONFIRMATION" && m.report && (
          <Button size="lg" onClick={acceptDlg.show}>
            <CheckCheck aria-hidden="true" /> Gemeldetes Resultat bestätigen
          </Button>
        )}
        {can.staffFinalize && (
          <Button variant={resolving ? "default" : "outline"} size="lg" onClick={() => setDeciding(true)}>
            <Gavel aria-hidden="true" />{" "}
            {resolving
              ? "Einspruch entscheiden"
              : m.status === "IN_PROGRESS"
                ? "Resultat festlegen"
                : "Anderes Resultat festlegen"}
          </Button>
        )}
        {can.voidResult && (
          <Button variant="destructive" size="lg" onClick={voidDlg.show}>
            <Trash2 aria-hidden="true" /> Annullieren
          </Button>
        )}
        {can.abandon && (
          <Button variant="destructive" size="lg" onClick={abandonDlg.show}>
            <Ban aria-hidden="true" /> Match abbrechen
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={acceptDlg.open}
        onOpenChange={acceptDlg.setOpen}
        title="Gemeldetes Resultat bestätigen?"
        description={
          m.report
            ? `Team ${m.report.winnerSide} gewinnt (gemeldet${m.report.byName ? ` von ${m.report.byName}` : ""}). Das Match wird sofort gewertet.`
            : undefined
        }
        confirmLabel="Bestätigen und werten"
        busy={pending != null}
        onConfirm={() =>
          m.report &&
          finalize(
            {
              winnerSide: m.report.winnerSide,
              endType: m.report.endType,
              cupsRemainingA: m.report.cupsRemainingA,
              cupsRemainingB: m.report.cupsRemainingB,
            },
            "",
          )
        }
      />

      <ConfirmDialog
        open={voidDlg.open}
        onOpenChange={voidDlg.setOpen}
        title="Resultat annullieren?"
        description="Das Match wird nicht gewertet und bleibt als «annulliert» im Verlauf."
        confirmLabel="Annullieren"
        tone="destructive"
        busy={pending != null}
        canConfirm={reasonOk(voidReason)}
        onConfirm={async () => {
          const out = await run(
            "void",
            () => voidEloResultAction({ matchId: m.id, expectedVersion: ops.version, reason: voidReason }),
            { successToast: "Resultat annulliert" },
          );
          if (out.kind === "ok") voidDlg.hide();
        }}
      >
        <ReasonField id="elo-void-reason" value={voidReason} onChange={setVoidReason} />
      </ConfirmDialog>

      <ConfirmDialog
        open={abandonDlg.open}
        onOpenChange={abandonDlg.setOpen}
        title="Laufendes Match abbrechen?"
        description="Es wird nicht gewertet. Tisch und Spieler:innen sind danach sofort frei."
        confirmLabel="Match abbrechen"
        tone="destructive"
        busy={pending != null}
        canConfirm={reasonOk(abandonReason)}
        onConfirm={async () => {
          const out = await run(
            "abandon",
            () =>
              abandonEloMatchAction({ matchId: m.id, expectedVersion: ops.version, reason: abandonReason }),
            { successToast: "Match abgebrochen" },
          );
          if (out.kind === "ok") abandonDlg.hide();
        }}
      >
        <ReasonField id="elo-abandon-reason" value={abandonReason} onChange={setAbandonReason} />
      </ConfirmDialog>

      <ConfirmDialog
        open={consentDlg.open}
        onOpenChange={consentDlg.setOpen}
        title="Zustimmung vor Ort erfassen"
        description="Nur wenn die Spieler:innen dir die Aufstellung persönlich bestätigt haben (z. B. ohne Handy)."
        confirmLabel="Zustimmung erfassen"
        busy={pending != null}
        canConfirm={consentSides.length > 0}
        onConfirm={async () => {
          const out = await run(
            "staffConsent",
            () =>
              staffConsentEloRosterAction({
                matchId: m.id,
                rosterHash: ops.rosterHash,
                sides: consentSides,
                note: consentNote.trim() || undefined,
              }),
            { successToast: "Zustimmung erfasst" },
          );
          if (out.kind === "ok") consentDlg.hide();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">Für welches Team?</legend>
          {missing.map((s) => (
            <label key={s} className="flex min-h-12 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="accent-primary size-5"
                checked={consentSides.includes(s)}
                onChange={(e) =>
                  setConsentSides((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                }
              />
              Team {s}
            </label>
          ))}
        </fieldset>
        <ReasonField
          id="elo-consent-note"
          value={consentNote}
          onChange={setConsentNote}
          min={0}
          max={300}
          label="Notiz (freiwillig)"
          placeholder="z. B. Handy leer"
        />
      </ConfirmDialog>
    </section>
  );
}
