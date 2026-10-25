// Anti-farming house rule: repeated meetings of the *identical* opposing rosters count less.
// The multiplier scales the total transfer before it is split, so ratings stay zero-sum.
import { fail } from "../errors";

/**
 * Normalized key of an opposing-roster pairing. Player order and swapping A/B give the same key.
 * Each side is a JSON array of sorted ids; arrays are self-delimiting, so the key is unambiguous.
 */
export function rosterPairKey(sideA: readonly string[], sideB: readonly string[]): string {
  const a = JSON.stringify([...sideA].sort());
  const b = JSON.stringify([...sideB].sort());
  return a <= b ? `${a}${b}` : `${b}${a}`;
}

/**
 * Multiplier for a rated meeting that has `priorCount` earlier rated meetings of the same pairing.
 * Entry i applies to the (i+1)-th meeting; the last entry applies to all later ones.
 */
export function multiplierFor(priorCount: number, multipliers: readonly number[]): number {
  if (!Number.isInteger(priorCount) || priorCount < 0) {
    fail("VALIDATION", "Die Anzahl früherer Begegnungen muss eine ganze Zahl ≥ 0 sein.", {
      field: "priorCount",
    });
  }
  if (multipliers.length === 0) {
    fail("VALIDATION", "Es braucht mindestens einen Wiederholungs-Faktor.", { field: "repeatMultipliers" });
  }
  return multipliers[Math.min(priorCount, multipliers.length - 1)];
}

/** How a match will count, for the pre-match banner. */
export type RatingTier = "FULL" | "PARTIAL" | "UNRATED";

export function ratingTier(multiplier: number): RatingTier {
  if (multiplier >= 1) return "FULL";
  return multiplier > 0 ? "PARTIAL" : "UNRATED";
}
