"use client";

import { useState, type ReactNode } from "react";
import { Check, Clock3, Hourglass } from "lucide-react";
import { clockTime, formatRating } from "@/lib/elo-format";
import { eloEventLabel } from "@/lib/i18n/de-elo";
import type { EloLiveMatch, EloLiveParticipant, EloSideKey } from "@/lib/elo-live-types";
import type { EloMatchDetail } from "@/server/services/elo-read";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SideTag } from "./elo-team";
import { PlayerAvatar } from "./player-avatar";

/** One side of a match: players with their current rating and, in a draft, the consent state. */
export function SideCard({
  side,
  players,
  meId,
  consent,
  winner,
}: {
  side: EloSideKey;
  players: readonly EloLiveParticipant[];
  meId: string | null;
  /** Drafts only: has this side agreed to the current roster? */
  consent?: boolean;
  winner?: boolean;
}) {
  return (
    <section
      aria-label={`Team ${side}`}
      className={cn(
        "bg-card flex flex-col gap-3 rounded-2xl border-2 p-4",
        winner ? "border-gold" : side === "A" ? "border-team-home/50" : "border-team-away/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-2xl leading-none">
          <SideTag side={side} decorative /> Team {side}
        </h2>
        {consent !== undefined &&
          (consent ? (
            <span className="text-success inline-flex items-center gap-1 text-sm font-semibold">
              <Check className="size-4" aria-hidden="true" /> bestätigt
            </span>
          ) : (
            <span className="text-warning inline-flex items-center gap-1 text-sm font-semibold">
              <Hourglass className="size-4" aria-hidden="true" /> wartet
            </span>
          ))}
      </div>
      <ul className="flex flex-col gap-2">
        {players.map((p) => (
          <li key={p.userId} className="flex items-center gap-3">
            <PlayerAvatar userId={p.userId} name={p.displayName} side={side} size="md" />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {p.displayName}
              {p.userId === meId && <span className="text-primary"> (du)</span>}
            </span>
            {Number.isFinite(p.rating) && (
              <span className="tabular text-muted-foreground text-sm">{formatRating(p.rating)} Elo</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Dialog with a cancel and one confirm button (every irreversible step asks once more). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "default",
  busy,
  canConfirm = true,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "default" | "destructive";
  busy: boolean;
  canConfirm?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AdminDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      tone={tone}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
            Zurück
          </Button>
          <Button
            size="lg"
            variant={tone === "destructive" ? "destructive-solid" : "default"}
            disabled={busy || !canConfirm}
            onClick={onConfirm}
          >
            {busy ? "Sende …" : confirmLabel}
          </Button>
        </div>
      }
    >
      {children}
    </AdminDialog>
  );
}

/** State + dialog in one: `trigger` opens it, the dialog closes itself after a successful action. */
export function useDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function MatchTimeline({ events }: { events: EloMatchDetail["events"] }) {
  if (events.length === 0) return null;
  return (
    <details className="bg-card/60 rounded-2xl border p-4">
      <summary className="font-display flex min-h-10 cursor-pointer items-center gap-2 text-lg">
        <Clock3 className="size-5" aria-hidden="true" /> Verlauf
      </summary>
      <ol className="mt-3 flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 text-sm">
            <span className="tabular text-muted-foreground w-12 shrink-0">{clockTime(e.at)}</span>
            <span>
              <span className="font-semibold">{eloEventLabel[e.type] ?? e.type}</span>
              {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Live shape for a match that is no longer in the live snapshot (older result, cancelled …). */
export function matchFromDetail(d: EloMatchDetail): EloLiveMatch {
  const side = (s: EloSideKey): EloLiveParticipant[] =>
    d.sides[s].map((p, i) => ({
      userId: p.userId,
      displayName: p.displayName,
      side: s,
      position: i + 1,
      rating:
        d.ratingChanges.find((c) => c.userId === p.userId)?.ratingAfter ?? p.ratingAtStart ?? Number.NaN,
      ratingAtStart: p.ratingAtStart,
    }));
  return {
    id: d.id,
    status: d.status,
    rated: d.rated,
    tableId: "",
    tableNumber: d.tableNumber,
    tableName: d.tableName,
    createdById: "",
    sideA: side("A"),
    sideB: side("B"),
    consentA: false,
    consentB: false,
    expiresAt: null,
    timer: d.timer,
    report: null,
    dispute: d.disputeNote ? { byName: null, at: 0, note: d.disputeNote } : null,
    result:
      d.result && d.status === "COMPLETED" && d.result.sequence != null && d.result.confirmedAt != null
        ? {
            winnerSide: d.result.winnerSide,
            endType: d.result.endType,
            cupsRemainingA: d.result.cupsRemainingA,
            cupsRemainingB: d.result.cupsRemainingB,
            confirmedAt: d.result.confirmedAt,
            sequence: d.result.sequence,
            multiplier: d.result.multiplier,
            expectedScoreA: d.result.expectedScoreA,
          }
        : null,
    ratingChanges: d.ratingChanges.map((c) => ({
      userId: c.userId,
      delta: c.delta,
      ratingAfter: c.ratingAfter,
    })),
    prospective: null,
  };
}
