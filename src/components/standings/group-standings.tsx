import { CircleCheck, CircleDashed, Scale } from "lucide-react";
import type { LiveGroup, LiveStandingRow, LiveTeam } from "@/lib/live-types";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { cn } from "@/lib/utils";

export const tiebreakLabel: Partial<Record<NonNullable<LiveStandingRow["decidedBy"]>, string>> = {
  HEAD_TO_HEAD: "Direktbegegnung",
  SHOOTOUT: "Ranking-Shootout",
};

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

export function TieBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "border-warning/70 bg-warning/15 text-warning inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        className,
      )}
    >
      <Scale className="size-3.5" aria-hidden="true" /> Gleichstand: Shootout ausstehend
    </span>
  );
}

/** Qualification marker: final (icon + "Qualifiziert") or provisional. */
export function QualifierMark({
  row,
  complete,
  className,
}: {
  row: LiveStandingRow;
  complete: boolean;
  className?: string;
}) {
  if (!row.qualified) return null;
  return complete && !row.provisional ? (
    <span className={cn("text-success inline-flex items-center gap-1 font-semibold", className)}>
      <CircleCheck className="size-[1.1em]" aria-hidden="true" /> Qualifiziert
    </span>
  ) : (
    <span className={cn("text-muted-foreground inline-flex items-center gap-1", className)}>
      <CircleDashed className="size-[1.1em]" aria-hidden="true" /> Vorläufig Q-Platz
    </span>
  );
}

function RankCell({ row, qualifiedFinal }: { row: LiveStandingRow; qualifiedFinal: boolean }) {
  return (
    <span
      className={cn(
        "font-display tabular flex size-8 items-center justify-center rounded-lg text-lg leading-none",
        qualifiedFinal
          ? "bg-success/15 text-success"
          : row.qualified
            ? "bg-muted text-foreground"
            : "text-muted-foreground",
      )}
      aria-label={row.rank != null ? `Rang ${row.rank}` : "Rang offen"}
    >
      {row.rank ?? "–"}
    </span>
  );
}

type Variant = "full" | "mini";

const cols: Record<Variant, string> = {
  // Rang · Team · Sp · Pkt · Diff (+ Becher on ≥ sm)
  full: "grid-cols-[2rem_minmax(0,1fr)_1.75rem_2.25rem_2.75rem] sm:grid-cols-[2rem_minmax(0,1fr)_2rem_3.5rem_2.5rem_3rem]",
  mini: "grid-cols-[2rem_minmax(0,1fr)_2.25rem_2.75rem]",
};

/**
 * Group table without a dense <table>: a 4–6 column grid with the team name truncating.
 * Cups for/against go to a second line on phones and into their own column from `sm`.
 */
export function GroupStandings({
  group,
  teamById,
  variant = "full",
  myTeamId,
  className,
}: {
  group: LiveGroup;
  teamById: Map<string, LiveTeam>;
  variant?: Variant;
  myTeamId?: string | null;
  className?: string;
}) {
  const full = variant === "full";
  return (
    <div
      className={cn("flex flex-col", className)}
      role="table"
      aria-label={`Rangliste Gruppe ${group.name}`}
    >
      <div
        role="row"
        className={cn(
          "text-muted-foreground grid items-center gap-x-2 border-b px-1 pb-1.5 text-xs font-semibold tracking-wide uppercase",
          cols[variant],
        )}
      >
        <span role="columnheader">
          <abbr title="Rang" className="no-underline">
            #
          </abbr>
        </span>
        <span role="columnheader">Team</span>
        {full && (
          <span role="columnheader" className="text-right">
            <abbr title="Spiele" className="no-underline">
              Sp
            </abbr>
          </span>
        )}
        {full && (
          <span role="columnheader" className="hidden text-right sm:block">
            <abbr title="Becher erzielt : erhalten" className="no-underline">
              Becher
            </abbr>
          </span>
        )}
        <span role="columnheader" className="text-right">
          <abbr title="Punkte" className="no-underline">
            Pkt
          </abbr>
        </span>
        <span role="columnheader" className="text-right">
          <abbr title="Becherdifferenz" className="no-underline">
            Diff
          </abbr>
        </span>
      </div>
      {group.rows.map((row) => {
        const team = teamById.get(row.teamId);
        const name = team?.name ?? "Unbekanntes Team";
        const finalQ = row.qualified && group.complete && !row.provisional;
        const tiebreak = row.decidedBy ? tiebreakLabel[row.decidedBy] : undefined;
        const mine = !!myTeamId && myTeamId === row.teamId;
        return (
          <div
            key={row.teamId}
            role="row"
            className={cn(
              "grid items-center gap-x-2 border-b border-dashed px-1 py-2 last:border-b-0",
              cols[variant],
              mine && "bg-primary/8 rounded-lg",
            )}
          >
            <span role="cell">
              <RankCell row={row} qualifiedFinal={finalQ} />
            </span>
            <span role="cell" className="flex min-w-0 items-center gap-2">
              <TeamAvatar name={name} logoUrl={team?.logoUrl} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    "font-semibold",
                    full ? "line-clamp-2 leading-tight break-words" : "truncate",
                  )}
                  title={name}
                >
                  {name}
                  {mine && <span className="text-primary ml-1.5 text-xs font-bold">(Du)</span>}
                </span>
                {full && (
                  <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="tabular sm:hidden">
                      Becher {row.cupsFor}:{row.cupsAgainst}
                    </span>
                    <QualifierMark row={row} complete={group.complete} />
                    {tiebreak && <span>per {tiebreak}</span>}
                  </span>
                )}
              </span>
            </span>
            {full && (
              <span role="cell" className="tabular text-muted-foreground text-right">
                {row.played}
              </span>
            )}
            {full && (
              <span role="cell" className="tabular text-muted-foreground hidden text-right sm:block">
                {row.cupsFor}:{row.cupsAgainst}
              </span>
            )}
            <span role="cell" className="font-display tabular text-right text-xl leading-none">
              {row.points}
            </span>
            <span
              role="cell"
              className={cn(
                "tabular text-right font-semibold",
                row.cupDiff > 0
                  ? "text-success"
                  : row.cupDiff < 0
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {signed(row.cupDiff)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function GroupStatusLine({ group }: { group: LiveGroup }) {
  if (group.unresolvedTie) return <TieBadge />;
  return group.complete ? (
    <span className="text-success inline-flex items-center gap-1.5 text-xs font-semibold">
      <CircleCheck className="size-3.5" aria-hidden="true" /> Abgeschlossen
    </span>
  ) : (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold">
      <CircleDashed className="size-3.5" aria-hidden="true" /> Läuft, Ränge vorläufig
    </span>
  );
}
