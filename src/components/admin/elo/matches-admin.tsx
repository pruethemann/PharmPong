"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Pencil, Trash2, Trophy, X } from "lucide-react";
import { correctEloMatchAction, voidCompletedEloMatchAction } from "@/server/actions/elo-admin";
import type { EloAdminMatchRow } from "@/server/services/elo-read";
import { clockTime, teamLabel } from "@/lib/elo-format";
import { eloEndTypeLabel } from "@/lib/i18n/de-elo";
import type { EloEndTypeKey, EloMatchStatusKey, EloRosterEntry, EloSideKey } from "@/lib/elo-live-types";
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from "@/lib/admin-idempotency";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { NativeSelect, ReasonField, reasonOk } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { EloStatusPill } from "@/components/elo/elo-status-pill";
import { SideTag } from "@/components/elo/elo-team";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Runner = ReturnType<typeof useAdminAction>;

const PAGE = 12;

const FILTERS: { key: string; label: string; statuses: EloMatchStatusKey[] | null }[] = [
  { key: "all", label: "Alle", statuses: null },
  { key: "done", label: "Beendet", statuses: ["COMPLETED"] },
  { key: "open", label: "Offen", statuses: ["DRAFT", "IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"] },
  { key: "off", label: "Abgebrochen / annulliert", statuses: ["CANCELLED", "VOIDED"] },
];

type Draft = {
  winnerSide: EloSideKey;
  endType: EloEndTypeKey;
  rated: boolean;
  sideA: string[];
  sideB: string[];
};

function draftOf(m: EloAdminMatchRow): Draft {
  return {
    winnerSide: m.winnerSide ?? "A",
    endType: m.endType ?? "REGULAR",
    rated: m.rated,
    sideA: m.sideA.map((p) => p.userId),
    sideB: m.sideB.map((p) => p.userId),
  };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function RosterEditor({
  side,
  ids,
  other,
  roster,
  nameOf,
  onChange,
}: {
  side: EloSideKey;
  ids: string[];
  other: string[];
  roster: readonly EloRosterEntry[];
  nameOf: (id: string) => string;
  onChange: (ids: string[]) => void;
}) {
  const available = roster.filter((r) => !ids.includes(r.userId) && !other.includes(r.userId));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 flex items-center gap-2 font-semibold">
        <SideTag side={side} decorative className="size-6 text-sm" /> Team {side}
      </legend>
      <ul className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <li key={id} className="bg-muted flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm">
            {nameOf(id)}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${nameOf(id)} aus Team ${side} entfernen`}
              disabled={ids.length <= 1}
              onClick={() => onChange(ids.filter((x) => x !== id))}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {ids.length < 4 && (
        <NativeSelect
          aria-label={`Spieler:in zu Team ${side} hinzufügen`}
          value=""
          onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
        >
          <option value="">Spieler:in hinzufügen …</option>
          {available.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.displayName}
            </option>
          ))}
        </NativeSelect>
      )}
    </fieldset>
  );
}

function CorrectDialog({
  match,
  roster,
  runner,
  onClose,
}: {
  match: EloAdminMatchRow;
  roster: readonly EloRosterEntry[];
  runner: Runner;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(match));
  const [reason, setReason] = useState("");
  const names = useMemo(
    () =>
      new Map([
        ...roster.map((r) => [r.userId, r.displayName] as const),
        ...[...match.sideA, ...match.sideB].map((p) => [p.userId, p.displayName] as const),
      ]),
    [roster, match],
  );
  const nameOf = (id: string) => names.get(id) ?? "?";
  const before = draftOf(match);
  const changes = {
    ...(d.winnerSide !== before.winnerSide ? { winnerSide: d.winnerSide } : {}),
    ...(d.endType !== before.endType ? { endType: d.endType } : {}),
    ...(d.rated !== before.rated ? { rated: d.rated } : {}),
    ...(!same(d.sideA, before.sideA) ? { sideA: d.sideA } : {}),
    ...(!same(d.sideB, before.sideB) ? { sideB: d.sideB } : {}),
    // Cups are optional facts; a changed winner or end type would contradict them.
    ...(d.winnerSide !== before.winnerSide || d.endType !== before.endType
      ? { cupsRemainingA: null, cupsRemainingB: null }
      : {}),
  };
  const changed = Object.keys(changes).length > 0;
  return (
    <AdminDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Match korrigieren"
      description="Alle Elo-Werte ab diesem Match werden neu berechnet (neue Berechnung, die alte bleibt im Verlauf)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zurück
          </Button>
          <Button
            disabled={runner.pending !== null || !changed || !reasonOk(reason, 5)}
            onClick={async () => {
              // Same key for every retry of this correction (network loss: replayed, never doubled).
              const key = getOrCreateIdempotencyKey(match.id, "elo-correct", match.resultVersion);
              const res = await runner.run(
                "correct",
                () =>
                  correctEloMatchAction({
                    matchId: match.id,
                    expectedVersion: match.version,
                    resultVersion: match.resultVersion,
                    reason,
                    idempotencyKey: key,
                    changes,
                  }),
                { success: (r) => `Korrigiert. Neue Berechnung Nr. ${r.runRevision}.` },
              );
              if (res) clearIdempotencyKey(match.id, "elo-correct", match.resultVersion);
              if (res?.ok) onClose();
            }}
          >
            Korrektur speichern
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Sieger</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["A", "B"] as const).map((s) => (
            <label
              key={s}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3",
                d.winnerSide === s ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              <input
                type="radio"
                name="winner"
                checked={d.winnerSide === s}
                onChange={() => setD({ ...d, winnerSide: s })}
                className="accent-primary size-5"
              />
              Team {s}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Spielende</legend>
        <NativeSelect
          aria-label="Spielende"
          value={d.endType}
          onChange={(e) => setD({ ...d, endType: e.target.value as EloEndTypeKey })}
        >
          {(["REGULAR", "CONCEDED"] as const).map((t) => (
            <option key={t} value={t}>
              {eloEndTypeLabel[t]}
            </option>
          ))}
        </NativeSelect>
      </fieldset>
      <label className="bg-muted/30 flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3">
        <span className="font-semibold">Um Elo gespielt</span>
        <Switch
          checked={d.rated}
          onCheckedChange={(v) => setD({ ...d, rated: v })}
          aria-label="Um Elo gespielt"
        />
      </label>
      <RosterEditor
        side="A"
        ids={d.sideA}
        other={d.sideB}
        roster={roster}
        nameOf={nameOf}
        onChange={(ids) => setD({ ...d, sideA: ids })}
      />
      <RosterEditor
        side="B"
        ids={d.sideB}
        other={d.sideA}
        roster={roster}
        nameOf={nameOf}
        onChange={(ids) => setD({ ...d, sideB: ids })}
      />
      <ReasonField
        id="correct-reason"
        value={reason}
        onChange={setReason}
        min={5}
        placeholder="z. B. Sieger vertauscht"
      />
    </AdminDialog>
  );
}

/** All matches of the round, newest first; completed ones can be corrected or annulled. */
export function MatchesAdmin({
  matches,
  roster,
  runner,
}: {
  matches: EloAdminMatchRow[];
  roster: readonly EloRosterEntry[];
  runner: Runner;
}) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<EloAdminMatchRow | null>(null);
  const [voiding, setVoiding] = useState<EloAdminMatchRow | null>(null);
  const [reason, setReason] = useState("");
  const f = FILTERS.find((x) => x.key === filter)!;
  const filtered = f.statuses ? matches.filter((m) => f.statuses!.includes(m.status)) : matches;
  const shown = filtered.slice(0, limit);

  return (
    <section aria-labelledby="matches-title" className="flex flex-col gap-3">
      <h2 id="matches-title" className="text-2xl leading-none">
        Matches
      </h2>
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Button
            key={x.key}
            size="sm"
            variant={filter === x.key ? "default" : "outline"}
            aria-pressed={filter === x.key}
            onClick={() => {
              setFilter(x.key);
              setLimit(PAGE);
            }}
          >
            {x.label}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground">Keine Matches.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((m) => (
            <li key={m.id} className="bg-card flex flex-col gap-2 rounded-2xl border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {m.sequence != null && (
                  <span className="tabular text-muted-foreground font-semibold">#{m.sequence}</span>
                )}
                <span className="text-muted-foreground">
                  Tisch {m.tableNumber} · {clockTime(m.confirmedAt ?? m.createdAt)}
                </span>
                <EloStatusPill status={m.status} size="sm" />
                {!m.rated && (
                  <span className="text-muted-foreground text-xs font-semibold">Freundschaftsspiel</span>
                )}
                {m.rated && m.multiplier != null && m.multiplier < 1 && (
                  <span className="text-muted-foreground text-xs font-semibold">
                    Wiederholung ×{m.multiplier}
                  </span>
                )}
              </div>
              {(["A", "B"] as const).map((s) => (
                <p key={s} className="flex items-center gap-2">
                  <SideTag side={s} className="size-6 text-sm" />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      m.winnerSide === s && m.status === "COMPLETED" && "font-semibold",
                    )}
                  >
                    {teamLabel((s === "A" ? m.sideA : m.sideB).map((p) => p.displayName))}
                  </span>
                  {m.winnerSide === s && m.status === "COMPLETED" && (
                    <Trophy className="text-gold size-4 shrink-0" aria-label="Sieger" />
                  )}
                </p>
              ))}
              {m.disputeNote && <p className="text-destructive text-sm">Einspruch: «{m.disputeNote}»</p>}
              {m.cancelReason && <p className="text-muted-foreground text-sm">Grund: {m.cancelReason}</p>}
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/elo/matches/${m.id}`}
                  className="text-primary inline-flex min-h-10 items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline"
                >
                  Details <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
                {m.status === "COMPLETED" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(m)}
                      disabled={runner.pending !== null}
                    >
                      <Pencil aria-hidden="true" /> Korrigieren
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setReason("");
                        setVoiding(m);
                      }}
                      disabled={runner.pending !== null}
                    >
                      <Trash2 aria-hidden="true" /> Annullieren
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > shown.length && (
        <Button variant="outline" className="self-start" onClick={() => setLimit((n) => n + PAGE)}>
          Weitere {Math.min(PAGE, filtered.length - shown.length)} von {filtered.length - shown.length}{" "}
          anzeigen
        </Button>
      )}
      {editing && (
        <CorrectDialog
          key={editing.id}
          match={editing}
          roster={roster}
          runner={runner}
          onClose={() => setEditing(null)}
        />
      )}
      <AdminDialog
        open={voiding != null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Beendetes Match annullieren?"
        tone="destructive"
        description="Es zählt danach nicht mehr. Alle Elo-Werte werden ohne dieses Match neu berechnet."
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoiding(null)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={runner.pending !== null || !reasonOk(reason, 5)}
              onClick={async () => {
                if (!voiding) return;
                const res = await runner.run(
                  "voidCompleted",
                  () =>
                    voidCompletedEloMatchAction({
                      matchId: voiding.id,
                      expectedVersion: voiding.version,
                      reason,
                    }),
                  { success: "Match annulliert, Elo neu berechnet." },
                );
                if (res?.ok) setVoiding(null);
              }}
            >
              Annullieren
            </Button>
          </>
        }
      >
        <ReasonField id="void-completed-reason" value={reason} onChange={setReason} min={5} />
      </AdminDialog>
    </section>
  );
}
