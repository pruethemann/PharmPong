"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, MapPinOff, Save, Undo2 } from "lucide-react";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdminField, NativeSelect, ReasonField, aria, reasonOk } from "@/components/admin/fields";
import type { TeamIndex } from "@/components/admin/live-bits";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from "@/lib/admin-idempotency";
import { checkAdminResult, normalizeAdminResult, resultChanged } from "@/lib/admin-result";
import { endTypeLabel, tableStateLabel, type EndTypeKey } from "@/lib/i18n/de";
import type { AuthedSnapshot, LiveMatch } from "@/lib/live-types";
import { cn } from "@/lib/utils";
import {
  abortMatchAction,
  assignMatchAction,
  confirmResultAction,
  correctResultAction,
  forfeitMatchAction,
  rejectProposalAction,
  resolveIssueAction,
  unassignMatchAction,
} from "@/server/actions/matches";
import type { RecoveryRequest } from "./recovery-wizard";

type Runner = ReturnType<typeof useAdminAction>;

export type ActionCtx = {
  match: LiveMatch;
  snap: AuthedSnapshot;
  teams: TeamIndex;
  online: boolean;
  runner: Runner;
  version: number;
};

const disabledReason = (online: boolean) =>
  online ? null : "Offline: Aktionen sind gesperrt, bis die Verbindung steht.";

function OfflineHint({ online }: { online: boolean }) {
  const r = disabledReason(online);
  return r ? (
    <p className="text-warning flex items-start gap-2 text-sm font-semibold" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {r}
    </p>
  ) : null;
}

// ─── Assign / unassign ─────────────────────────────────────────────────────

function tableOptionLabel(number: number, name: string) {
  const base = `Tisch ${number}`;
  return name.trim() === "" || name.trim() === base ? base : `${base} · ${name}`;
}

export function AssignAction({ match, snap, online, runner, version }: ActionCtx) {
  const suggestedTable = snap.admin?.suggestions.find((s) => s.matchId === match.id)?.tableId;
  const usable = snap.tables.filter((t) => t.state !== "DISABLED");
  const free = usable.filter((t) => t.state === "AVAILABLE");
  const [tableId, setTableId] = useState(suggestedTable ?? free[0]?.id ?? usable[0]?.id ?? "");
  const table = snap.tables.find((t) => t.id === tableId);
  // Only an override when the scheduler actually proposed a (different) table.
  const isOverride = !!suggestedTable && !!tableId && tableId !== suggestedTable;
  const busyTable = !!table && table.state !== "AVAILABLE";
  return (
    <div className="flex flex-col gap-4">
      <AdminField
        id="assign-table"
        label="Tisch"
        hint={
          isOverride
            ? "Admin-Override: nicht der Vorschlag des Schedulers. Schiris können das nicht rückgängig machen."
            : suggestedTable
              ? "Vorschlag des Schedulers."
              : undefined
        }
      >
        <NativeSelect
          {...aria("assign-table", null, true)}
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
        >
          {snap.tables.map((t) => (
            <option key={t.id} value={t.id} disabled={t.state === "DISABLED"}>
              {`${tableOptionLabel(t.number, t.name)} (${tableStateLabel[t.state]})${t.id === suggestedTable ? " · Vorschlag" : ""}`}
            </option>
          ))}
        </NativeSelect>
      </AdminField>
      {busyTable && (
        <p className="text-warning text-sm font-semibold">
          {free.length > 0
            ? "An diesem Tisch ist bereits ein Spiel aktiv. Bitte einen freien Tisch wählen."
            : "Alle Tische sind belegt. Zuweisen ist möglich, sobald ein Tisch frei wird."}
        </p>
      )}
      {snap.tournament.isPaused && (
        <p className="text-warning text-sm font-semibold">Turnier pausiert: Zuweisen ist blockiert.</p>
      )}
      <OfflineHint online={online} />
      <Button
        size="lg"
        disabled={!online || runner.pending !== null || !tableId || busyTable || snap.tournament.isPaused}
        onClick={() =>
          runner.run(
            "assign",
            () => assignMatchAction({ matchId: match.id, tableId, expectedVersion: version }),
            {
              success: (d) =>
                `${match.code} an Tisch ${table?.number ?? "?"} zugewiesen${d.override ? " (Override)" : ""}.`,
            },
          )
        }
      >
        {runner.pending === "assign" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight aria-hidden="true" />
        )}
        An Tisch {table?.number ?? "?"} zuweisen
      </Button>
    </div>
  );
}

export function UnassignAction({ match, online, runner, version }: ActionCtx) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Gibt den Tisch frei, das Spiel wird wieder «Bereit». Nur vor dem Start möglich.
      </p>
      <OfflineHint online={online} />
      <Button
        variant="outline"
        size="lg"
        disabled={!online || runner.pending !== null}
        onClick={() =>
          runner.run("unassign", () => unassignMatchAction({ matchId: match.id, expectedVersion: version }), {
            success: `Zuweisung von ${match.code} aufgehoben.`,
          })
        }
      >
        {runner.pending === "unassign" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <MapPinOff aria-hidden="true" />
        )}
        Zuweisung aufheben
      </Button>
    </div>
  );
}

// ─── Confirm (admin as referee) ────────────────────────────────────────────

export function ConfirmAction({ match, snap, teams, online, runner, version }: ActionCtx) {
  const ops = snap.matchOps?.[match.id];
  const p = ops?.proposal;
  if (!ops || !p) return <p className="text-muted-foreground">Kein Resultatvorschlag vorhanden.</p>;
  const rev = ops.resultRevision;
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/40 grid gap-2 rounded-xl border p-3">
        <p className="text-muted-foreground text-sm">Vorschlag der Schiedsrichter:in</p>
        <p className="text-lg font-semibold">
          Sieger: <span className="text-gold">{teams.get(p.winnerTeamId)?.name ?? "?"}</span>
        </p>
        <p className="font-display tabular text-3xl leading-none">
          {p.homeCupsRemaining} : {p.awayCupsRemaining}
          <span className="text-muted-foreground ml-2 font-sans text-sm normal-case">
            Becher übrig (A : B)
          </span>
        </p>
        <p className="text-sm">{endTypeLabel[p.endType]}</p>
      </div>
      <OfflineHint online={online} />
      <HoldToConfirm
        tone="success"
        disabled={!online || runner.pending !== null}
        onConfirm={() =>
          void runner.run(
            "confirm",
            () =>
              confirmResultAction({
                matchId: match.id,
                expectedVersion: version,
                resultRevision: rev,
                idempotencyKey: getOrCreateIdempotencyKey(match.id, "confirm", rev),
              }),
            {
              success: `Resultat von ${match.code} bestätigt.`,
              onOk: () => clearIdempotencyKey(match.id, "confirm", rev),
            },
          )
        }
      >
        {runner.pending === "confirm" ? "Wird gespeichert …" : "Halten: Resultat bestätigen"}
      </HoldToConfirm>
    </div>
  );
}

// ─── Reject proposal ───────────────────────────────────────────────────────

export function RejectAction({ match, snap, online, runner, version }: ActionCtx) {
  const hasProposal = !!snap.matchOps?.[match.id]?.proposal;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Weist den Resultatvorschlag zurück: Das Spiel läuft wieder, die Uhr bleibt erhalten und die
        Schiedsrichter:in erfasst das Resultat neu.
      </p>
      <OfflineHint online={online} />
      <Button
        variant="outline"
        size="lg"
        disabled={!online || runner.pending !== null || !hasProposal}
        onClick={() =>
          runner.run("reject", () => rejectProposalAction({ matchId: match.id, expectedVersion: version }), {
            success: `Vorschlag für ${match.code} zurückgewiesen. Das Spiel läuft wieder.`,
          })
        }
      >
        {runner.pending === "reject" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Undo2 aria-hidden="true" />
        )}
        Vorschlag zurückweisen
      </Button>
    </div>
  );
}

// ─── Abort ─────────────────────────────────────────────────────────────────

export function AbortAction({ match, online, runner, version }: ActionCtx) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Bricht das Spiel ab: Tisch, Uhr und Resultatvorschlag werden gelöscht, das Spiel ist wieder «Bereit».
      </p>
      <ReasonField
        id="abort-reason"
        value={reason}
        onChange={setReason}
        placeholder="z. B. falscher Tisch gestartet"
      />
      <OfflineHint online={online} />
      <HoldToConfirm
        disabled={!online || runner.pending !== null || !reasonOk(reason)}
        onConfirm={() =>
          void runner.run(
            "abort",
            () => abortMatchAction({ matchId: match.id, reason: reason.trim(), expectedVersion: version }),
            { success: `${match.code} abgebrochen.`, onOk: () => setReason("") },
          )
        }
      >
        {runner.pending === "abort" ? "Wird gespeichert …" : "Halten: Spiel abbrechen"}
      </HoldToConfirm>
    </div>
  );
}

// ─── Forfeit ───────────────────────────────────────────────────────────────

function TeamChoice({
  teams,
  match,
  value,
  onChange,
  label,
  name,
}: {
  teams: TeamIndex;
  match: LiveMatch;
  value: string;
  onChange: (id: string) => void;
  label: string;
  name: string;
}) {
  const options = [
    { id: match.homeTeamId, side: "home" as const },
    { id: match.awayTeamId, side: "away" as const },
  ].filter((o): o is { id: string; side: "home" | "away" } => !!o.id);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const team = teams.get(o.id);
          const checked = value === o.id;
          return (
            <label
              key={o.id}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                checked
                  ? o.side === "home"
                    ? "border-team-home bg-team-home/10"
                    : "border-team-away bg-team-away/10"
                  : "border-border hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={checked}
                onChange={() => onChange(o.id)}
                className="sr-only"
              />
              <TeamAvatar name={team?.name ?? "?"} logoUrl={team?.logoUrl} side={o.side} size="sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">{team?.name ?? "?"}</span>
              <span className="text-muted-foreground text-xs">{o.side === "home" ? "Team A" : "Team B"}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ForfeitAction({ match, teams, online, runner, version }: ActionCtx) {
  const [winner, setWinner] = useState("");
  const [reason, setReason] = useState("");
  const winnerName = winner ? teams.get(winner)?.name : null;
  return (
    <div className="flex flex-col gap-4">
      <TeamChoice
        teams={teams}
        match={match}
        value={winner}
        onChange={setWinner}
        label="Anwesendes Team (gewinnt 10:0)"
        name={`forfeit-${match.id}`}
      />
      <ReasonField
        id="forfeit-reason"
        value={reason}
        onChange={setReason}
        placeholder="z. B. Gegner nach 10 Min. nicht erschienen"
      />
      <OfflineHint online={online} />
      <HoldToConfirm
        disabled={!online || runner.pending !== null || !winner || !reasonOk(reason)}
        onConfirm={() =>
          void runner.run(
            "forfeit",
            () =>
              forfeitMatchAction({
                matchId: match.id,
                winnerTeamId: winner,
                reason: reason.trim(),
                expectedVersion: version,
              }),
            { success: `Forfait erfasst: ${winnerName ?? "?"} gewinnt ${match.code}.` },
          )
        }
      >
        {runner.pending === "forfeit"
          ? "Wird gespeichert …"
          : winnerName
            ? `Halten: Forfait für ${winnerName}`
            : "Team wählen"}
      </HoldToConfirm>
    </div>
  );
}

// ─── Resolve issue ─────────────────────────────────────────────────────────

export function ResolveIssueAction({ match, snap, online, runner }: ActionCtx) {
  const [note, setNote] = useState("");
  const issue = snap.matchOps?.[match.id]?.openIssue;
  return (
    <div className="flex flex-col gap-4">
      <p className="border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border p-3 font-semibold">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {issue || "Problem ohne Beschreibung"}
      </p>
      <AdminField id="issue-note" label="Notiz zur Lösung (optional)" hint="Höchstens 300 Zeichen.">
        <Textarea
          {...aria("issue-note", null, true)}
          value={note}
          maxLength={300}
          rows={2}
          className="bg-input/30 min-h-20 rounded-xl px-3.5 text-base md:text-base"
          onChange={(e) => setNote(e.target.value)}
        />
      </AdminField>
      <OfflineHint online={online} />
      <Button
        variant="success"
        size="lg"
        disabled={!online || runner.pending !== null}
        onClick={() =>
          runner.run(
            "resolve",
            () => resolveIssueAction({ matchId: match.id, note: note.trim() || undefined }),
            { success: `Problem bei ${match.code} als gelöst markiert.`, onOk: () => setNote("") },
          )
        }
      >
        {runner.pending === "resolve" && <Loader2 className="animate-spin" aria-hidden="true" />}
        Problem als gelöst markieren
      </Button>
    </div>
  );
}

// ─── Correct result ────────────────────────────────────────────────────────

const END_TYPES: EndTypeKey[] = ["REGULAR", "TIME_LIMIT", "SHOOTOUT", "FORFEIT"];
const CUPS = Array.from({ length: 11 }, (_, i) => i);

export function CorrectAction({
  match,
  teams,
  online,
  runner,
  version,
  onRecovery,
}: ActionCtx & { onRecovery: (r: RecoveryRequest) => void }) {
  const cur = match.result;
  const [winner, setWinner] = useState(cur?.winnerTeamId ?? "");
  const [home, setHome] = useState(cur?.homeCupsRemaining ?? 0);
  const [away, setAway] = useState(cur?.awayCupsRemaining ?? 0);
  const [endType, setEndType] = useState<EndTypeKey>(cur?.endType ?? "REGULAR");
  const [reason, setReason] = useState("");

  const draft = useMemo(
    () =>
      normalizeAdminResult({
        homeTeamId: match.homeTeamId ?? "",
        awayTeamId: match.awayTeamId ?? "",
        winnerTeamId: winner,
        homeCupsRemaining: home,
        awayCupsRemaining: away,
        endType,
      }),
    [match.homeTeamId, match.awayTeamId, winner, home, away, endType],
  );
  const invalid = winner ? checkAdminResult(draft) : "Bitte Siegerteam wählen.";
  const changed = resultChanged(draft, cur);
  const forfeit = endType === "FORFEIT";

  function submit() {
    const newResult = {
      winnerTeamId: draft.winnerTeamId,
      homeCupsRemaining: draft.homeCupsRemaining,
      awayCupsRemaining: draft.awayCupsRemaining,
      endType: draft.endType,
    };
    void runner.run(
      "correct",
      () =>
        correctResultAction({
          matchId: match.id,
          expectedVersion: version,
          reason: reason.trim(),
          ...newResult,
        }),
      {
        success: (d) =>
          `Resultat von ${match.code} korrigiert${d.reseeded.length ? `, neu gesetzt: ${d.reseeded.join(", ")}` : ""}.`,
        onOk: () => setReason(""),
        onError: (f) => {
          if (f.code === "DOWNSTREAM_STARTED" || f.code === "UNRESOLVED_TIE") {
            onRecovery({
              matchId: match.id,
              code: match.code,
              expectedVersion: version,
              reason: reason.trim(),
              newResult,
              cause: f.code,
            });
            return true;
          }
          return false;
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TeamChoice
        teams={teams}
        match={match}
        value={winner}
        onChange={setWinner}
        label="Siegerteam"
        name={`correct-${match.id}`}
      />
      <AdminField id="correct-end" label="Art des Spielendes">
        <NativeSelect
          id="correct-end"
          value={endType}
          onChange={(e) => setEndType(e.target.value as EndTypeKey)}
        >
          {END_TYPES.map((t) => (
            <option key={t} value={t}>
              {endTypeLabel[t]}
            </option>
          ))}
        </NativeSelect>
      </AdminField>
      <div className="grid grid-cols-2 gap-3">
        <AdminField
          id="correct-home"
          label="Becher übrig Team A"
          hint={forfeit ? "Forfait: 10:0" : undefined}
        >
          <NativeSelect
            {...aria("correct-home", null, forfeit)}
            value={draft.homeCupsRemaining}
            disabled={forfeit}
            onChange={(e) => setHome(Number(e.target.value))}
          >
            {CUPS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </AdminField>
        <AdminField id="correct-away" label="Becher übrig Team B">
          <NativeSelect
            id="correct-away"
            value={draft.awayCupsRemaining}
            disabled={forfeit}
            onChange={(e) => setAway(Number(e.target.value))}
          >
            {CUPS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </AdminField>
      </div>
      <div aria-live="polite">
        {invalid ? (
          <p className="text-warning flex items-start gap-2 text-sm font-semibold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {invalid}
          </p>
        ) : !changed ? (
          <p className="text-muted-foreground text-sm">Unverändert gegenüber dem bestätigten Resultat.</p>
        ) : null}
      </div>
      <ReasonField
        id="correct-reason"
        value={reason}
        onChange={setReason}
        min={5}
        placeholder="z. B. Becherzahl falsch erfasst"
      />
      <OfflineHint online={online} />
      <Button
        size="lg"
        disabled={!online || runner.pending !== null || !!invalid || !changed || !reasonOk(reason, 5)}
        onClick={submit}
      >
        {runner.pending === "correct" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Save aria-hidden="true" />
        )}
        Korrektur speichern
      </Button>
      <p className="text-muted-foreground text-xs">
        Haben Folgespiele schon begonnen, öffnet sich der Wiederherstellungs-Assistent.
      </p>
    </div>
  );
}
