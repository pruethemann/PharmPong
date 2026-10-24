"use client";

import { Minus, Plus, Trophy } from "lucide-react";
import { endTypeLabel } from "@/lib/i18n/de";
import type { LiveTeam } from "@/lib/live-types";
import { CUPS_PER_SIDE, REFEREE_END_TYPES, type RefereeEndType, type Side } from "@/lib/result-form";
import { cn } from "@/lib/utils";
import { sideLabel } from "./team-hero";

const sideText = { home: "text-team-home", away: "text-team-away" } as const;

export function FieldHint({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="text-warning text-sm font-semibold">
      {text}
    </p>
  );
}

const END_TYPE_HELP: Record<RefereeEndType, string> = {
  REGULAR: "Ein Team hat alle Becher getroffen",
  TIME_LIMIT: "Zeit um, mehr Becher gewinnen",
  SHOOTOUT: "Gleichstand nach Zeitablauf",
};

/** Segmented control: how did the match end? */
export function EndTypeControl({
  value,
  onChange,
  disabled,
  describedBy,
}: {
  value: RefereeEndType | null;
  onChange: (v: RefereeEndType) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Art des Spielendes"
      aria-describedby={describedBy}
      className="bg-muted/60 grid grid-cols-3 gap-1.5 rounded-2xl p-1.5"
    >
      {REFEREE_END_TYPES.map((t) => {
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-2 text-center transition-colors disabled:opacity-50",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground hover:bg-background/60",
            )}
          >
            <span className="text-[0.95rem] leading-tight font-bold">{endTypeLabel[t]}</span>
            <span
              className={cn(
                "hidden text-xs leading-tight sm:block",
                active ? "text-primary-foreground/80" : "text-muted-foreground",
              )}
            >
              {END_TYPE_HELP[t]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** −/+ stepper for the cups still standing on one side. */
export function CupStepper({
  side,
  team,
  value,
  onChange,
  disabled,
  showZero,
  describedBy,
}: {
  side: Side;
  team: LiveTeam | null;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  showZero?: boolean;
  describedBy?: string;
}) {
  const name = team?.name ?? sideLabel(side);
  const labelId = `cups-${side}-label`;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className={cn(
        "bg-card flex flex-col gap-2 rounded-2xl border-2 p-3",
        side === "home" ? "border-team-home/40" : "border-team-away/40",
      )}
    >
      <p id={labelId} className="flex min-w-0 items-baseline gap-1.5 text-sm">
        <span className="text-muted-foreground shrink-0">Becher übrig bei</span>
        <span className={cn("truncate font-bold", sideText[side])}>{name}</span>
      </p>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={`Ein Becher weniger bei ${name}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
          className="bg-muted hover:bg-muted/70 flex size-16 shrink-0 items-center justify-center rounded-2xl border transition-colors active:translate-y-px disabled:opacity-40"
        >
          <Minus className="size-8" aria-hidden="true" />
        </button>
        <output
          aria-live="polite"
          aria-label={`${value} Becher übrig bei ${name}`}
          className={cn("font-display tabular min-w-16 text-center text-6xl leading-none", sideText[side])}
        >
          {value}
        </output>
        <button
          type="button"
          aria-label={`Ein Becher mehr bei ${name}`}
          disabled={disabled || value >= CUPS_PER_SIDE}
          onClick={() => onChange(value + 1)}
          className="bg-muted hover:bg-muted/70 flex size-16 shrink-0 items-center justify-center rounded-2xl border transition-colors active:translate-y-px disabled:opacity-40"
        >
          <Plus className="size-8" aria-hidden="true" />
        </button>
      </div>
      {showZero && (
        <button
          type="button"
          disabled={disabled || value === 0}
          onClick={() => onChange(0)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted min-h-12 rounded-xl border border-dashed text-sm font-semibold transition-colors disabled:opacity-40"
        >
          Alle getroffen: auf 0 setzen
        </button>
      )}
    </div>
  );
}

/** Huge selectable winner card. Selected: thick ring in team colour + gold trophy + "SIEGER". */
export function WinnerCard({
  side,
  team,
  selected,
  dimmed,
  suggested,
  onSelect,
  disabled,
  describedBy,
}: {
  side: Side;
  team: LiveTeam | null;
  selected: boolean;
  dimmed: boolean;
  suggested: boolean;
  onSelect: () => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const name = team?.name ?? sideLabel(side);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "bg-card relative flex min-h-32 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition-all disabled:opacity-50",
        side === "home" ? "border-team-home/40" : "border-team-away/40",
        selected && side === "home" && "border-team-home bg-team-home/15 ring-team-home ring-4",
        selected && side === "away" && "border-team-away bg-team-away/15 ring-team-away ring-4",
        dimmed && "opacity-45",
        suggested && !selected && "border-dashed",
      )}
    >
      <span className={cn("font-display text-xs tracking-widest", sideText[side])}>{sideLabel(side)}</span>
      <span className="font-display line-clamp-2 text-2xl leading-none break-words sm:text-3xl">{name}</span>
      {selected ? (
        <span className="font-display text-gold mt-1 inline-flex items-center gap-1.5 text-xl">
          <Trophy className="size-6" aria-hidden="true" /> Sieger
        </span>
      ) : suggested ? (
        <span className="text-muted-foreground mt-1 text-xs font-semibold">Vorschlag · tippen</span>
      ) : (
        <span className="text-muted-foreground mt-1 text-xs">Tippen = Sieger</span>
      )}
    </button>
  );
}
