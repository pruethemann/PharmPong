// Deterministic rating replay: the ratings of a session are a pure fold over its COMPLETED
// matches in authoritative confirmation order, starting from the run's initial rating.
//
// The same code path serves both cases:
//   - a normal confirmation replays the history plus the new match and persists only the new step;
//   - a correction (winner, roster, rated flag, void, parameters) replays everything into a new run.
// Floats are never read back from storage as inputs, so replaying twice yields identical bits.
import { fail } from "../errors";
import { validateEloParams } from "./config";
import { PHARMA_ELO_V1, type RatingEngine, type RatingResult } from "./engine";
import { multiplierFor, rosterPairKey } from "./repeat";
import { assertValidRoster } from "./roster";
import type { EloParams, Side } from "./types";

/** One COMPLETED match with its current roster and result. */
export type ReplayEntry = {
  matchId: string;
  /** Authoritative confirmation sequence (unique, increasing; never a timestamp). */
  sequence: number;
  /** false = friendly: recorded and counted as played, but never rated and not a repeat occurrence. */
  rated: boolean;
  winner: Side;
  sideA: readonly string[];
  sideB: readonly string[];
};

/** Current standing of one player (the persisted projection). */
export type PlayerProjection = {
  userId: string;
  rating: number;
  /** Effective-rated matches only (rated and multiplier > 0). */
  gamesPlayed: number;
  wins: number;
  losses: number;
  lowestRating: number;
  peakRating: number;
  /** Sequence of the last effective-rated match. */
  lastSequence: number | null;
};

export type ReplayStep = {
  matchId: string;
  sequence: number;
  winner: Side;
  sideA: string[];
  sideB: string[];
  rated: boolean;
  pairKey: string;
  /** Earlier rated meetings of the same normalized pairing (friendlies do not count). */
  priorCount: number;
  /** Applied repeat multiplier; 0 for friendlies. */
  multiplier: number;
  /** Rated with multiplier > 0: the only steps that move ratings and count as rated games. */
  effective: boolean;
  /** Calculation for rated matches (also at multiplier 0, all deltas 0); null for friendlies. */
  result: RatingResult | null;
};

export type ReplayState = {
  players: Map<string, PlayerProjection>;
  /** Rated meetings so far per pairing key. */
  pairCounts: Map<string, number>;
  lastSequence: number;
};

export function createReplayState(): ReplayState {
  return { players: new Map(), pairCounts: new Map(), lastSequence: 0 };
}

export function ratingOf(state: ReplayState, userId: string, initialRating: number): number {
  return state.players.get(userId)?.rating ?? initialRating;
}

function newProjection(userId: string, initialRating: number): PlayerProjection {
  return {
    userId,
    rating: initialRating,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    lowestRating: initialRating,
    peakRating: initialRating,
    lastSequence: null,
  };
}

/** Applies one match to `state` (mutated) and returns the calculation step. */
export function applyMatch(
  state: ReplayState,
  entry: ReplayEntry,
  params: EloParams,
  engine: RatingEngine = PHARMA_ELO_V1,
): ReplayStep {
  if (!Number.isInteger(entry.sequence) || entry.sequence <= state.lastSequence) {
    fail("VALIDATION", "Die Bestätigungsreihenfolge muss streng aufsteigend sein.", {
      field: "sequence",
      matchId: entry.matchId,
    });
  }
  assertValidRoster(entry.sideA, entry.sideB);
  state.lastSequence = entry.sequence;
  const pairKey = rosterPairKey(entry.sideA, entry.sideB);
  const priorCount = state.pairCounts.get(pairKey) ?? 0;
  const base = {
    matchId: entry.matchId,
    sequence: entry.sequence,
    winner: entry.winner,
    sideA: [...entry.sideA],
    sideB: [...entry.sideB],
    rated: entry.rated,
    pairKey,
    priorCount,
  };
  if (!entry.rated) return { ...base, multiplier: 0, effective: false, result: null };

  state.pairCounts.set(pairKey, priorCount + 1);
  const multiplier = multiplierFor(priorCount, params.repeatMultipliers);
  const withRatings = (ids: readonly string[]) =>
    ids.map((userId) => ({ userId, rating: ratingOf(state, userId, params.initialRating) }));
  const result = engine.calculate({
    sideA: withRatings(entry.sideA),
    sideB: withRatings(entry.sideB),
    winner: entry.winner,
    kFactor: params.kFactor,
    ratingScale: params.ratingScale,
    multiplier,
  });
  const effective = multiplier > 0;
  if (effective) {
    for (const c of result.changes) {
      const p = state.players.get(c.userId) ?? newProjection(c.userId, params.initialRating);
      p.rating = c.ratingAfter;
      p.gamesPlayed += 1;
      if (c.side === entry.winner) p.wins += 1;
      else p.losses += 1;
      p.lowestRating = Math.min(p.lowestRating, p.rating);
      p.peakRating = Math.max(p.peakRating, p.rating);
      p.lastSequence = entry.sequence;
      state.players.set(c.userId, p);
    }
  }
  return { ...base, multiplier, effective, result };
}

/** Full replay from the initial ratings, in confirmation order. */
export function replaySession(
  entries: readonly ReplayEntry[],
  params: EloParams,
  engine: RatingEngine = PHARMA_ELO_V1,
): { state: ReplayState; steps: ReplayStep[] } {
  validateEloParams(params);
  const ordered = [...entries].sort((a, b) => a.sequence - b.sequence);
  const state = createReplayState();
  const steps = ordered.map((e) => applyMatch(state, e, params, engine));
  return { state, steps };
}

/** Projections sorted by userId (stable order for persistence and comparison). */
export function projectionsOf(state: ReplayState): PlayerProjection[] {
  return [...state.players.values()]
    .map((p) => ({ ...p }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/** Exact fingerprint of the projection (17 significant digits round-trip every double). */
export function projectionDigest(state: ReplayState): string {
  return projectionsOf(state)
    .map((p) =>
      [
        p.userId,
        p.rating.toPrecision(17),
        p.gamesPlayed,
        p.wins,
        p.losses,
        p.lowestRating.toPrecision(17),
        p.peakRating.toPrecision(17),
        p.lastSequence ?? "-",
      ].join(":"),
    )
    .join(";");
}

export type ProjectionComparison = {
  /** Largest absolute rating deviation (Infinity if a player is missing on one side). */
  maxDeviation: number;
  /** Players whose counters differ or whose ratings deviate by more than the tolerance. */
  mismatchedUserIds: string[];
};

/**
 * Compares a stored projection with a replayed one. A tolerance is needed only across
 * JavaScript runtimes (the last bit of 10 ** x may differ between engines).
 */
export function compareProjections(
  expected: readonly PlayerProjection[],
  actual: readonly PlayerProjection[],
  tolerance = 1e-9,
): ProjectionComparison {
  const byId = (list: readonly PlayerProjection[]) => new Map(list.map((p) => [p.userId, p]));
  const e = byId(expected);
  const a = byId(actual);
  const ids = [...new Set([...e.keys(), ...a.keys()])].sort();
  let maxDeviation = 0;
  const mismatchedUserIds: string[] = [];
  for (const id of ids) {
    const x = e.get(id);
    const y = a.get(id);
    if (!x || !y) {
      maxDeviation = Infinity;
      mismatchedUserIds.push(id);
      continue;
    }
    const dev = Math.max(
      Math.abs(x.rating - y.rating),
      Math.abs(x.lowestRating - y.lowestRating),
      Math.abs(x.peakRating - y.peakRating),
    );
    maxDeviation = Math.max(maxDeviation, dev);
    const countsDiffer =
      x.gamesPlayed !== y.gamesPlayed ||
      x.wins !== y.wins ||
      x.losses !== y.losses ||
      x.lastSequence !== y.lastSequence;
    if (countsDiffer || dev > tolerance) mismatchedUserIds.push(id);
  }
  return { maxDeviation, mismatchedUserIds };
}

/** |Σ (rating − initial)| over all players: 0 up to floating-point noise, since every match is zero-sum. */
export function conservationError(players: readonly PlayerProjection[], initialRating: number): number {
  let sum = 0;
  for (const p of players) sum += p.rating - initialRating;
  return Math.abs(sum);
}
