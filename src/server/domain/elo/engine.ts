// PharmaElo v1: an Elo-inspired rating for temporary teams. It is a PharmaPong house system,
// not calibrated chess Elo (see docs/elo-mode/rating-system.md).
//
//   team rating   R_T = mean of the members' ratings (not the sum)
//   expectation   E_A = 1 / (1 + 10^((R_B − R_A) / D)),   E_B = 1 − E_A
//   transfer      Δ_A = K · (S_A − E_A) · multiplier,      Δ_B = −Δ_A
//   per player    every A player gets Δ_A / n_A, every B player gets −Δ_A / n_B   (zero-sum)
//
// Deterministic: means are summed in ascending order, so the roster order never changes a bit.
// Nothing is rounded; there are no floors or ceilings.
import { fail } from "../errors";
import { ELO_ALGORITHM_VERSION } from "./config";
import { assertValidRoster } from "./roster";
import type { RatedPlayer, Side } from "./types";

export type RatingInput = {
  sideA: readonly RatedPlayer[];
  sideB: readonly RatedPlayer[];
  winner: Side;
  kFactor: number;
  ratingScale: number;
  /** Repeat-match multiplier in [0, 1], applied to the total transfer before it is split. */
  multiplier: number;
};

export type PlayerRatingChange = {
  userId: string;
  side: Side;
  ratingBefore: number;
  delta: number;
  ratingAfter: number;
  /** Win probability of the player's side. */
  expectedScore: number;
  teamSize: number;
  opponentTeamSize: number;
};

export type RatingResult = {
  algorithmVersion: string;
  teamRatingA: number;
  teamRatingB: number;
  expectedA: number;
  expectedB: number;
  multiplier: number;
  /** Total transfer to side A after the multiplier; side B receives −transferA. */
  transferA: number;
  /** Side A in input order, then side B in input order. */
  changes: PlayerRatingChange[];
};

/** Extension point for future algorithms (e.g. Glicko-2 or TrueSkill); v1 is PHARMA_ELO_V1. */
export interface RatingEngine {
  readonly version: string;
  calculate(input: RatingInput): RatingResult;
}

/** Ratings outside ±1e9 are rejected (matches the database CHECK constraints). */
export const MAX_ABS_RATING = 1e9;

function invalid(field: string, message: string): never {
  fail("VALIDATION", message, { field });
}

/** Turns −0 into 0 so results serialize and compare cleanly. */
const clean = (x: number): number => (x === 0 ? 0 : x);

/** Arithmetic mean, summed in ascending order (independent of roster order). */
export function teamRating(ratings: readonly number[]): number {
  if (ratings.length === 0) invalid("roster", "Ein Team braucht mindestens eine Spieler:in.");
  const sorted = [...ratings].sort((a, b) => a - b);
  let sum = 0;
  for (const r of sorted) sum += r;
  return sum / sorted.length;
}

/** Elo logistic expectation of side A. */
export function expectedScore(teamRatingA: number, teamRatingB: number, ratingScale: number): number {
  return 1 / (1 + 10 ** ((teamRatingB - teamRatingA) / ratingScale));
}

function assertRatingInput(input: RatingInput): void {
  assertValidRoster(
    input.sideA.map((p) => p.userId),
    input.sideB.map((p) => p.userId),
  );
  for (const p of [...input.sideA, ...input.sideB]) {
    if (!Number.isFinite(p.rating) || Math.abs(p.rating) >= MAX_ABS_RATING) {
      invalid(
        "rating",
        "Ungültige Wertung: Ratings müssen endliche Zahlen mit Betrag unter 1 Milliarde sein.",
      );
    }
  }
  if (input.winner !== "A" && input.winner !== "B") {
    invalid("winner", "Es gibt kein Unentschieden: Sieger ist Team A oder Team B.");
  }
  if (!(Number.isFinite(input.kFactor) && input.kFactor > 0)) {
    invalid("kFactor", "Der K-Faktor muss eine positive Zahl sein.");
  }
  if (!(Number.isFinite(input.ratingScale) && input.ratingScale > 0)) {
    invalid("ratingScale", "Die Skala D muss eine positive Zahl sein.");
  }
  if (!(Number.isFinite(input.multiplier) && input.multiplier >= 0 && input.multiplier <= 1)) {
    invalid("multiplier", "Der Wiederholungs-Faktor muss zwischen 0 und 1 liegen.");
  }
}

function calculate(input: RatingInput): RatingResult {
  assertRatingInput(input);
  const { sideA, sideB, winner, kFactor, ratingScale, multiplier } = input;
  const teamRatingA = teamRating(sideA.map((p) => p.rating));
  const teamRatingB = teamRating(sideB.map((p) => p.rating));
  const expectedA = expectedScore(teamRatingA, teamRatingB, ratingScale);
  const expectedB = 1 - expectedA;
  const scoreA = winner === "A" ? 1 : 0;
  const transferA = clean(kFactor * (scoreA - expectedA) * multiplier);
  const perA = clean(transferA / sideA.length);
  const perB = clean(-transferA / sideB.length);
  const change = (
    p: RatedPlayer,
    side: Side,
    delta: number,
    expected: number,
    size: number,
    opponents: number,
  ): PlayerRatingChange => ({
    userId: p.userId,
    side,
    ratingBefore: p.rating,
    delta,
    ratingAfter: p.rating + delta,
    expectedScore: expected,
    teamSize: size,
    opponentTeamSize: opponents,
  });
  return {
    algorithmVersion: ELO_ALGORITHM_VERSION,
    teamRatingA,
    teamRatingB,
    expectedA,
    expectedB,
    multiplier,
    transferA,
    changes: [
      ...sideA.map((p) => change(p, "A", perA, expectedA, sideA.length, sideB.length)),
      ...sideB.map((p) => change(p, "B", perB, expectedB, sideB.length, sideA.length)),
    ],
  };
}

export const PHARMA_ELO_V1: RatingEngine = { version: ELO_ALGORITHM_VERSION, calculate };
