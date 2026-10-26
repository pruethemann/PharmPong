"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Minus, Plus, Trophy } from "lucide-react";
import { validateEloResult } from "@/server/domain/elo/result-rules";
import { DomainError } from "@/server/domain/errors";
import { CUPS_PER_SIDE } from "@/server/domain/types";
import { teamLabel } from "@/lib/elo-format";
import { eloEndTypeLabel } from "@/lib/i18n/de-elo";
import type { EloEndTypeKey, EloSideKey } from "@/lib/elo-live-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SideTag } from "./elo-team";
import { AvatarStack } from "./player-avatar";

type Player = { userId: string; displayName: string };

export type EloResultPayload = {
  winnerSide: EloSideKey;
  endType: EloEndTypeKey;
  cupsRemainingA: number | null;
  cupsRemainingB: number | null;
};

const END_HINT: Record<EloEndTypeKey, string> = {
  REGULAR: "Das andere Team hat keinen Becher mehr.",
  CONCEDED: "Ein Team hat vorzeitig aufgegeben.",
};

function CupCounter({
  side,
  value,
  onChange,
  fixedZero,
}: {
  side: EloSideKey;
  value: number;
  onChange: (v: number) => void;
  fixedZero?: boolean;
}) {
  const label = `Becher übrig bei Team ${side}`;
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <SideTag side={side} decorative className="size-6 text-sm" /> Becher übrig
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Ein Becher weniger bei Team ${side}`}
          disabled={fixedZero || value <= 0}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <output
          aria-live="polite"
          aria-label={`${value} ${label}`}
          className="font-display tabular w-10 text-center text-3xl"
        >
          {value}
        </output>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Ein Becher mehr bei Team ${side}`}
          disabled={fixedZero || value >= CUPS_PER_SIDE}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Two-step result entry: tap the winning team, then review and send. Plain buttons only (no
 * press-and-hold or swipe), and nothing is sent before the explicit confirmation on step two.
 * Remaining cups are optional and never change the Elo.
 */
export function ResultEntry({
  sideA,
  sideB,
  initial,
  title = "Wer hat gewonnen?",
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  extra,
  extraValid = true,
}: {
  sideA: readonly Player[];
  sideB: readonly Player[];
  initial?: EloResultPayload | null;
  title?: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (r: EloResultPayload) => void;
  onCancel: () => void;
  /** e.g. the reason field of a referee decision. */
  extra?: ReactNode;
  extraValid?: boolean;
}) {
  const [winner, setWinner] = useState<EloSideKey | null>(initial?.winnerSide ?? null);
  const [endType, setEndType] = useState<EloEndTypeKey>(initial?.endType ?? "REGULAR");
  const [withCups, setWithCups] = useState(
    initial?.cupsRemainingA != null || initial?.cupsRemainingB != null,
  );
  const [cups, setCups] = useState<Record<EloSideKey, number>>({
    A: initial?.cupsRemainingA ?? 1,
    B: initial?.cupsRemainingB ?? 1,
  });

  if (!winner) {
    return (
      <section aria-labelledby="result-title" className="flex flex-col gap-3">
        <h2 id="result-title" className="text-2xl leading-none">
          {title}
        </h2>
        {(["A", "B"] as const).map((side) => {
          const players = side === "A" ? sideA : sideB;
          return (
            <button
              key={side}
              type="button"
              onClick={() => setWinner(side)}
              className={cn(
                "bg-card flex min-h-24 items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors active:translate-y-px",
                side === "A"
                  ? "border-team-home/60 hover:bg-team-home/10"
                  : "border-team-away/60 hover:bg-team-away/10",
              )}
            >
              <SideTag side={side} decorative className="size-10 text-2xl" />
              <span className="min-w-0 flex-1">
                <span className="font-display block text-2xl leading-tight">Team {side}</span>
                <span className="text-muted-foreground block break-words">
                  {teamLabel(players.map((p) => p.displayName))}
                </span>
              </span>
              <Trophy className="text-muted-foreground size-7 shrink-0" aria-hidden="true" />
            </button>
          );
        })}
        <Button variant="ghost" size="lg" onClick={onCancel}>
          <ArrowLeft aria-hidden="true" /> Abbrechen
        </Button>
      </section>
    );
  }

  const loser: EloSideKey = winner === "A" ? "B" : "A";
  const payload: EloResultPayload = {
    winnerSide: winner,
    endType,
    cupsRemainingA: withCups ? (endType === "REGULAR" && loser === "A" ? 0 : cups.A) : null,
    cupsRemainingB: withCups ? (endType === "REGULAR" && loser === "B" ? 0 : cups.B) : null,
  };
  let error: string | null = null;
  try {
    validateEloResult(payload);
  } catch (e) {
    error = e instanceof DomainError ? e.message : "Ungültiges Resultat.";
  }
  const players = winner === "A" ? sideA : sideB;

  return (
    <section aria-labelledby="result-review" className="flex flex-col gap-4">
      <h2 id="result-review" className="text-2xl leading-none">
        Stimmt das so?
      </h2>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border-2 p-4",
          winner === "A" ? "border-team-home bg-team-home/10" : "border-team-away bg-team-away/10",
        )}
      >
        <Trophy className="text-gold size-8 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-tight">Team {winner} gewinnt</p>
          <p className="text-foreground/85 break-words">{teamLabel(players.map((p) => p.displayName))}</p>
        </div>
        <AvatarStack players={players} side={winner} size="sm" className="hidden min-[400px]:flex" />
      </div>
      <Button variant="outline" onClick={() => setWinner(null)} className="self-start">
        <ArrowLeft aria-hidden="true" /> Anderes Team wählen
      </Button>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Wie endete das Spiel?</legend>
        <div className="grid gap-2 min-[400px]:grid-cols-2">
          {(["REGULAR", "CONCEDED"] as const).map((t) => (
            <label
              key={t}
              className={cn(
                "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 p-3",
                endType === t ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              <input
                type="radio"
                name="elo-end-type"
                value={t}
                checked={endType === t}
                onChange={() => setEndType(t)}
                className="accent-primary mt-1 size-5"
              />
              <span>
                <span className="block font-semibold">{eloEndTypeLabel[t]}</span>
                <span className="text-muted-foreground block text-sm">{END_HINT[t]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="bg-muted/30 flex flex-col gap-3 rounded-xl border p-3">
        <label className="flex min-h-12 cursor-pointer items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={withCups}
            onChange={(e) => setWithCups(e.target.checked)}
            className="accent-primary size-5"
          />
          Becher übrig angeben (freiwillig, zählt nicht für Elo)
        </label>
        {withCups && (
          <div className="flex flex-col gap-3">
            {(["A", "B"] as const).map((side) => (
              <CupCounter
                key={side}
                side={side}
                value={endType === "REGULAR" && side === loser ? 0 : cups[side]}
                fixedZero={endType === "REGULAR" && side === loser}
                onChange={(v) => setCups((c) => ({ ...c, [side]: v }))}
              />
            ))}
          </div>
        )}
      </div>

      {extra}

      {error && (
        <p role="alert" className="text-destructive text-sm font-semibold">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" size="lg" onClick={onCancel} className="sm:flex-1" disabled={busy}>
          Abbrechen
        </Button>
        <Button
          size="xl"
          className="sm:flex-[2]"
          disabled={busy || !!error || !extraValid}
          onClick={() => onSubmit(payload)}
        >
          {busy ? "Sende …" : submitLabel}
        </Button>
      </div>
    </section>
  );
}
