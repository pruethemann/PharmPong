import Link from "next/link";
import { Crown } from "lucide-react";
import { formatDelta, formatPercent, gamesLabel, ratingLabels } from "@/lib/elo-format";
import type { EloLeaderRow } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";

export function ProvisionalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "border-border text-muted-foreground inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[0.7rem] font-semibold",
        className,
      )}
    >
      vorläufig
    </span>
  );
}

export function DeltaText({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(value * 10) / 10;
  return (
    <span
      className={cn(
        "tabular font-semibold",
        rounded > 0 ? "text-success" : rounded < 0 ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {formatDelta(value)}
    </span>
  );
}

const winRate = (r: EloLeaderRow) => (r.gamesPlayed > 0 ? formatPercent(r.wins / r.gamesPlayed) : "–");

/**
 * Elo ranking as a real table. Narrow screens keep three columns (rank, player, Elo) and move
 * games, W–L and the change since the start into a second line under the name: no horizontal
 * scrolling at 360 px.
 */
export function Leaderboard({
  rows,
  meId = null,
  championIds = [],
  caption,
  dense = false,
}: {
  rows: readonly EloLeaderRow[];
  meId?: string | null;
  championIds?: readonly string[];
  caption: string;
  /** Home preview: no extra desktop columns. */
  dense?: boolean;
}) {
  const labels = ratingLabels(rows.map((r) => r.rating));
  const champions = new Set(championIds);
  const wide = dense ? "hidden" : "hidden sm:table-cell";
  return (
    <table className="w-full border-separate border-spacing-y-1.5 text-left">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th scope="col" className="w-10 px-2 font-semibold">
            #
          </th>
          <th scope="col" className="w-full px-2 font-semibold">
            Spieler:in
          </th>
          <th scope="col" className={cn(wide, "px-2 text-right font-semibold")}>
            Spiele
          </th>
          <th scope="col" className={cn(wide, "px-2 text-right font-semibold")}>
            S–N
          </th>
          <th scope="col" className={cn(wide, "px-2 text-right font-semibold")}>
            Quote
          </th>
          <th scope="col" className={cn(wide, "px-2 text-right font-semibold")}>
            <abbr title="Veränderung seit Start" className="no-underline">
              ±
            </abbr>
          </th>
          <th scope="col" className="px-2 text-right font-semibold whitespace-nowrap">
            Elo
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const me = r.userId === meId;
          const champion = champions.has(r.userId);
          return (
            <tr
              key={r.userId}
              className={cn(
                "[&>td]:bg-card [&>td]:py-2 [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl",
                me && "[&>td]:bg-primary/10",
              )}
            >
              <td className="font-display tabular px-2 text-xl leading-none">
                {champion ? (
                  <Crown className="text-gold size-5" aria-label={`Champion, Rang ${r.rank}`} />
                ) : (
                  r.rank
                )}
              </td>
              {/* w-full + max-w-0: the name column takes all remaining width and truncates. */}
              <td className="w-full max-w-0 px-1">
                <Link
                  href={`/elo/players/${r.userId}`}
                  className="group flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-1"
                >
                  <PlayerAvatar userId={r.userId} name={r.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold underline-offset-4 group-hover:underline">
                        {r.displayName}
                      </span>
                      {me && <span className="text-primary shrink-0 text-xs font-semibold">(du)</span>}
                      {r.provisional && <ProvisionalBadge />}
                    </span>
                    <span
                      className={cn("text-muted-foreground block truncate text-xs", !dense && "sm:hidden")}
                    >
                      {gamesLabel(r.gamesPlayed)} · {r.wins}–{r.losses} ·{" "}
                      <DeltaText value={r.ratingChange} className="font-normal" />
                    </span>
                  </span>
                </Link>
              </td>
              <td className={cn(wide, "tabular px-2 text-right whitespace-nowrap")}>{r.gamesPlayed}</td>
              <td className={cn(wide, "tabular px-2 text-right whitespace-nowrap")}>
                {r.wins}–{r.losses}
              </td>
              <td className={cn(wide, "tabular px-2 text-right whitespace-nowrap")}>{winRate(r)}</td>
              <td className={cn(wide, "px-2 text-right whitespace-nowrap")}>
                <DeltaText value={r.ratingChange} />
              </td>
              <td className="font-display tabular px-2 text-right text-2xl leading-none whitespace-nowrap">
                {labels[i]}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Legend under every ranking: what "vorläufig" means. */
export function ProvisionalLegend({ minGames }: { minGames: number }) {
  if (minGames <= 0) return null;
  return (
    <p className="text-muted-foreground text-sm">
      <ProvisionalBadge className="mr-1.5 align-middle" />
      weniger als {minGames} gewertete Spiele: zählt noch nicht für den Titel.
    </p>
  );
}
