// Leaderboard ranking and champion eligibility. Ranking uses full-precision ratings; only the
// display rounds. Ranking position and champion eligibility are separate concepts.
import type { PlayerProjection } from "./replay";

export type RankedPlayer = PlayerProjection & {
  /** Competition ranking: exactly equal ratings share a rank (1, 2, 2, 4). */
  rank: number;
  /** Fewer than the session's minimum rated games: shown, rated, but not champion-eligible. */
  provisional: boolean;
  eligible: boolean;
  /** Rating change since the start of the session. */
  ratingChange: number;
};

export type RankOptions = {
  minGamesForChampion: number;
  initialRating: number;
  /** Display-only order within an exact tie (e.g. the display name); falls back to the userId. */
  tieKey?: (userId: string) => string;
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function rankPlayers(players: readonly PlayerProjection[], opts: RankOptions): RankedPlayer[] {
  const key = opts.tieKey ?? (() => "");
  const sorted = [...players].sort(
    (a, b) => b.rating - a.rating || cmp(key(a.userId), key(b.userId)) || cmp(a.userId, b.userId),
  );
  const out: RankedPlayer[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const provisional = p.gamesPlayed < opts.minGamesForChampion;
    const change = p.rating - opts.initialRating;
    out.push({
      ...p,
      rank: prev && prev.rating === p.rating ? prev.rank : i + 1,
      provisional,
      eligible: !provisional,
      ratingChange: change === 0 ? 0 : change,
    });
  });
  return out;
}

/**
 * Champion(s): the eligible players with the highest full-precision rating. A genuine exact tie
 * produces co-champions; nothing is decided arbitrarily. Empty if nobody is eligible.
 */
export function championsOf(ranked: readonly RankedPlayer[]): RankedPlayer[] {
  const eligible = ranked.filter((p) => p.eligible);
  if (eligible.length === 0) return [];
  const best = Math.max(...eligible.map((p) => p.rating));
  return eligible.filter((p) => p.rating === best);
}
