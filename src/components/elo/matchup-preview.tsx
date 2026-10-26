import { Handshake, Info, Repeat2, User } from "lucide-react";
import { formatDelta, formatRating } from "@/lib/elo-format";
import type { EloSideKey } from "@/lib/elo-live-types";
import type { MatchupPreview } from "@/server/domain/elo/preview";
import { multiplierFor, rosterPairKey } from "@/server/domain/elo/repeat";
import { cn } from "@/lib/utils";
import { SideTag } from "./elo-team";

/** Whole percent, but never a misleading "0 %" or "100 %" for a possible outcome. */
function pct(p: number): string {
  const r = Math.round(p * 100);
  if (r === 0 && p > 0) return "<1 %";
  if (r === 100 && p < 1) return ">99 %";
  return `${r} %`;
}

/** How the repeat-match rule would count this pairing right now. */
export function prospectiveRepeat(
  sideA: readonly string[],
  sideB: readonly string[],
  pairCounts: Record<string, number>,
  multipliers: readonly number[],
): { priorCount: number; multiplier: number; pairKey: string } {
  const pairKey = rosterPairKey(sideA, sideB);
  const priorCount = pairCounts[pairKey] ?? 0;
  return { priorCount, multiplier: multiplierFor(priorCount, multipliers), pairKey };
}

/** 100 % split bar; the percentages are always written out (colour is never the only cue). */
export function WinProbabilityBar({ expectedA }: { expectedA: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
        <span className="text-team-home">
          Team A <span className="font-display tabular text-2xl">{pct(expectedA)}</span>
        </span>
        <span className="text-muted-foreground text-xs">Siegchance</span>
        <span className="text-team-away">
          <span className="font-display tabular text-2xl">{pct(1 - expectedA)}</span> Team B
        </span>
      </div>
      <div
        role="img"
        aria-label={`Siegchance: Team A ${pct(expectedA)}, Team B ${pct(1 - expectedA)}`}
        className="bg-muted flex h-4 overflow-hidden rounded-full"
      >
        <div className="bg-team-home h-full" style={{ width: `${expectedA * 100}%` }} />
        <div className="bg-team-away h-full flex-1 border-l-2 border-[var(--card)]" />
      </div>
    </div>
  );
}

function Outcome({ winner, a, b }: { winner: EloSideKey; a: number; b: number }) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex flex-col gap-2 rounded-xl border-2 p-3",
        winner === "A" ? "border-team-home/50" : "border-team-away/50",
      )}
    >
      <p className="flex flex-col gap-0.5">
        <span className="font-display text-base leading-none">Sieg Team {winner}</span>
        <span className="text-muted-foreground text-xs">Elo je Person</span>
      </p>
      {(["A", "B"] as const).map((side) => {
        const d = side === "A" ? a : b;
        return (
          <p key={side} className="flex items-center gap-2 text-sm">
            <SideTag side={side} className="size-6 text-sm" />
            <span
              className={cn(
                "font-display tabular text-xl leading-none",
                d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {formatDelta(d)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function repeatText(priorCount: number, multiplier: number): string {
  const nth = `${priorCount + 1}. Begegnung genau dieser Aufstellung`;
  if (multiplier === 0) return `${nth}: zählt nicht mehr für Elo.`;
  if (multiplier < 1) return `${nth}: zählt nur zu ${Math.round(multiplier * 100)} %.`;
  return `${nth}: zählt noch voll.`;
}

/**
 * What is at stake before a match: team averages, win probability, the Elo change per person for
 * both outcomes, the repeat-match rule and friendlies. Purely informative: the server recalculates
 * from the ratings at confirmation time.
 */
export function MatchupPreviewPanel({
  preview,
  sizeA,
  sizeB,
  rated,
  priorCount,
  pendingSamePairing,
}: {
  preview: MatchupPreview;
  sizeA: number;
  sizeB: number;
  rated: boolean;
  priorCount: number;
  /** An unconfirmed result of the same pairing exists: the count may still change. */
  pendingSamePairing: boolean;
}) {
  const solo = (sizeA === 1) !== (sizeB === 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        {(["A", "B"] as const).map((side) => (
          <div key={side} className="bg-muted/40 flex flex-col items-center gap-1 rounded-xl p-3">
            <SideTag side={side} />
            <span className="text-muted-foreground text-xs">Ø Elo</span>
            <span className="font-display tabular text-3xl leading-none">
              {formatRating(side === "A" ? preview.teamRatingA : preview.teamRatingB)}
            </span>
          </div>
        ))}
      </div>
      <WinProbabilityBar expectedA={preview.expectedA} />
      {rated ? (
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          <Outcome winner="A" a={preview.ifAWins.perPlayerA} b={preview.ifAWins.perPlayerB} />
          <Outcome winner="B" a={preview.ifBWins.perPlayerA} b={preview.ifBWins.perPlayerB} />
        </div>
      ) : (
        <p className="bg-muted/40 flex items-center gap-2 rounded-xl p-3 font-semibold">
          <Handshake className="text-primary size-5 shrink-0" aria-hidden="true" /> Freundschaftsspiel: Elo
          bleibt für alle unverändert.
        </p>
      )}
      {rated && priorCount > 0 && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-xl border p-3 text-sm",
            preview.multiplier === 0 ? "border-warning/60 text-warning" : "text-muted-foreground",
          )}
        >
          <Repeat2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {repeatText(priorCount, preview.multiplier)}
            {pendingSamePairing && " Offene Resultate dieser Aufstellung können das noch ändern."}
          </span>
        </p>
      )}
      {rated && solo && (
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <User className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Solo gegen ein Team: hohes Risiko, hohe Belohnung. Wer allein spielt, trägt die ganze Elo-Änderung
            des Teams.
          </span>
        </p>
      )}
      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>Vorschau mit den aktuellen Werten. Gerechnet wird beim Bestätigen des Resultats.</span>
      </p>
    </div>
  );
}
