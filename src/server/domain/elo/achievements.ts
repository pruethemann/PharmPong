// Social achievements, derived deterministically from the replay steps. They never affect Elo.
//
//   Most Active    most COMPLETED matches (friendlies and unrated repeats included).
//                  Tie: whoever reached that count first (lower sequence), then userId.
//   Biggest Upset  the win with the lowest predicted winning probability (< 0.5) among
//                  effective-rated matches. Tie: the earlier match. Holders: the winning side.
//   Best Comeback  the largest rise r_j − min(r_0 … r_{j−1}) of one player, counted only if that
//                  low was below the initial rating (the player really was down).
//                  Tie: the earlier sequence, then userId.
import type { ReplayStep } from "./replay";

export type AchievementHolder = {
  userIds: string[];
  /** Matches (most active), win probability (upset) or rating points recovered (comeback). */
  value: number;
  /** Confirmation sequence at which the value was reached. */
  sequence: number;
  matchId: string | null;
};

export type Achievements = {
  mostActive: AchievementHolder | null;
  biggestUpset: AchievementHolder | null;
  bestComeback: AchievementHolder | null;
};

function mostActive(steps: readonly ReplayStep[]): AchievementHolder | null {
  const count = new Map<string, number>();
  const reachedAt = new Map<string, number>();
  for (const s of steps) {
    for (const id of [...s.sideA, ...s.sideB]) {
      count.set(id, (count.get(id) ?? 0) + 1);
      reachedAt.set(id, s.sequence);
    }
  }
  let best: AchievementHolder | null = null;
  for (const [id, n] of count) {
    const at = reachedAt.get(id)!;
    const better =
      !best ||
      n > best.value ||
      (n === best.value && (at < best.sequence || (at === best.sequence && id < best.userIds[0])));
    if (better) best = { userIds: [id], value: n, sequence: at, matchId: null };
  }
  return best;
}

function biggestUpset(steps: readonly ReplayStep[]): AchievementHolder | null {
  let best: AchievementHolder | null = null;
  for (const s of steps) {
    if (!s.effective || !s.result) continue;
    const p = s.winner === "A" ? s.result.expectedA : s.result.expectedB;
    if (p >= 0.5) continue;
    if (!best || p < best.value) {
      const winners = s.winner === "A" ? s.sideA : s.sideB;
      best = { userIds: [...winners].sort(), value: p, sequence: s.sequence, matchId: s.matchId };
    }
  }
  return best;
}

function bestComeback(steps: readonly ReplayStep[], initialRating: number): AchievementHolder | null {
  const low = new Map<string, number>(); // min(r_0 … r_current)
  let best: AchievementHolder | null = null;
  for (const s of steps) {
    if (!s.effective || !s.result) continue;
    for (const c of s.result.changes) {
      const lowest = low.get(c.userId) ?? initialRating;
      if (lowest < initialRating) {
        const rise = c.ratingAfter - lowest;
        const better =
          rise > 0 &&
          (!best ||
            rise > best.value ||
            (rise === best.value &&
              (s.sequence < best.sequence || (s.sequence === best.sequence && c.userId < best.userIds[0]))));
        if (better) best = { userIds: [c.userId], value: rise, sequence: s.sequence, matchId: s.matchId };
      }
      low.set(c.userId, Math.min(lowest, c.ratingAfter));
    }
  }
  return best;
}

/** Steps must be in confirmation order (as returned by replaySession). */
export function computeAchievements(steps: readonly ReplayStep[], initialRating: number): Achievements {
  return {
    mostActive: mostActive(steps),
    biggestUpset: biggestUpset(steps),
    bestComeback: bestComeback(steps, initialRating),
  };
}
