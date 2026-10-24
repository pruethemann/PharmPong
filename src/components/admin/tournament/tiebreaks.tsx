"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Medal, Undo2 } from "lucide-react";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, ReasonField, aria, reasonOk } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { formatZurich } from "@/lib/admin-labels";
import { cn } from "@/lib/utils";
import { recordRankingShootoutAction, voidRankingShootoutAction } from "@/server/actions/tournament";
import type { TiebreakRow } from "@/server/services/admin-read";

type Runner = ReturnType<typeof useAdminAction>;
export type TieView = {
  group: string;
  basisHash: string;
  positions: number[];
  teams: { id: string; name: string; logoUrl: string | null }[];
};

/** Order the tied teams (best first) with 48px up/down buttons, then record. */
export function ShootoutForm({
  tie,
  runner,
  online,
  canRecord,
}: {
  tie: TieView;
  runner: Runner;
  online: boolean;
  canRecord: boolean;
}) {
  const [order, setOrder] = useState(tie.teams);
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState("");
  const id = `shootout-${tie.group}`;

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setAnnounce(`${next[j].name} jetzt auf Platz ${tie.positions[j] ?? j + 1}.`);
  }

  return (
    <article
      id={id}
      className="bg-card border-destructive/50 flex scroll-mt-24 flex-col gap-4 rounded-2xl border p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-2xl leading-none">Gruppe {tie.group}: Ranking-Shootout</h3>
        <p className="text-muted-foreground text-sm">
          Gleichstand um Platz {tie.positions.join(" & ")}. Reihenfolge nach dem Shootout festlegen (Bester
          zuoberst).
        </p>
      </header>
      <ol className="flex flex-col gap-2" aria-label="Reihenfolge">
        {order.map((t, i) => (
          <li key={t.id} className="bg-muted/30 flex items-center gap-3 rounded-xl border p-2 pl-3">
            <span className="font-display tabular text-primary w-10 text-2xl">
              {tie.positions[i] ?? i + 1}.
            </span>
            <TeamAvatar name={t.name} logoUrl={t.logoUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
            <Button
              variant="outline"
              size="icon"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label={`${t.name} nach oben`}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`${t.name} nach unten`}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <AdminField id={`${id}-note`} label="Notiz (optional)" hint="z. B. Ergebnis des Shootouts, Zeugen.">
        <Textarea
          {...aria(`${id}-note`, null, true)}
          value={note}
          maxLength={500}
          rows={2}
          className="bg-input/30 min-h-16 rounded-xl px-3.5 text-base md:text-base"
          onChange={(e) => setNote(e.target.value)}
        />
      </AdminField>
      {!canRecord && (
        <p className="text-warning text-sm font-semibold">
          Shootouts können nur in der Gruppenphase erfasst werden.
        </p>
      )}
      <Button
        size="lg"
        disabled={!online || !canRecord || runner.pending !== null}
        onClick={() =>
          runner.run(
            `shootout-${tie.group}`,
            () =>
              recordRankingShootoutAction({
                group: tie.group as "A" | "B" | "C" | "D",
                basisHash: tie.basisHash,
                orderedTeamIds: order.map((t) => t.id),
                note: note.trim() || null,
              }),
            { success: `Ranking-Shootout für Gruppe ${tie.group} erfasst.` },
          )
        }
      >
        {runner.pending === `shootout-${tie.group}` ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Medal aria-hidden="true" />
        )}
        Reihenfolge erfassen
      </Button>
    </article>
  );
}

export function TiebreakList({
  rows,
  runner,
  online,
  canVoid,
}: {
  rows: TiebreakRow[];
  runner: Runner;
  online: boolean;
  canVoid: boolean;
}) {
  const [target, setTarget] = useState<TiebreakRow | null>(null);
  const [reason, setReason] = useState("");
  if (rows.length === 0) {
    return <p className="text-muted-foreground">Noch keine Ranking-Shootouts erfasst.</p>;
  }
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn("bg-card flex flex-col gap-2 rounded-2xl border p-4", r.voidedAt && "opacity-60")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-xl leading-none">Gruppe {r.group}</span>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  r.voidedAt
                    ? "border-border text-muted-foreground line-through"
                    : "border-success/60 text-success",
                )}
              >
                {r.voidedAt ? "Aufgehoben" : "Gültig"}
              </span>
            </div>
            <ol className="text-sm">
              {r.orderedTeams.map((t, i) => (
                <li key={t.id} className="truncate">
                  <span className="tabular text-muted-foreground mr-1">{i + 1}.</span>
                  {t.name}
                </li>
              ))}
            </ol>
            {r.note && <p className="text-muted-foreground text-sm italic">«{r.note}»</p>}
            <p className="text-muted-foreground text-xs">
              {formatZurich(r.createdAt, "short")} · {r.recordedByName ?? "?"}
              {r.voidedAt && ` · aufgehoben ${formatZurich(r.voidedAt, "short")}`}
            </p>
            {!r.voidedAt && canVoid && (
              <Button
                variant="destructive"
                className="self-start"
                disabled={!online || runner.pending !== null}
                onClick={() => {
                  setReason("");
                  setTarget(r);
                }}
              >
                <Undo2 aria-hidden="true" /> Aufheben
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AdminDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        tone="destructive"
        title={`Shootout Gruppe ${target?.group ?? ""} aufheben?`}
        description="Der Gleichstand ist danach wieder offen und muss neu entschieden werden."
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={!online || !reasonOk(reason) || runner.pending !== null}
              onClick={async () => {
                if (!target) return;
                const res = await runner.run(
                  "void-tb",
                  () => voidRankingShootoutAction({ tiebreakId: target.id, reason: reason.trim() }),
                  { success: "Shootout aufgehoben." },
                );
                if (res?.ok) setTarget(null);
              }}
            >
              {runner.pending === "void-tb" && <Loader2 className="animate-spin" aria-hidden="true" />}
              Aufheben
            </Button>
          </>
        }
      >
        <ReasonField id="void-tb-reason" value={reason} onChange={setReason} />
      </AdminDialog>
    </>
  );
}
