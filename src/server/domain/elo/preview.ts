// Pre-match preview: what each outcome would do with the current authoritative ratings.
// A preview is never persisted; the confirmation recalculates from the rating state at that time.
import { PHARMA_ELO_V1, type RatingEngine, type RatingResult } from "./engine";
import type { EloParams, RatedPlayer } from "./types";

export type OutcomePreview = {
  /** Total transfer to side A (negative if A loses). */
  transferA: number;
  /** Change of every A player. */
  perPlayerA: number;
  /** Change of every B player. */
  perPlayerB: number;
};

export type MatchupPreview = {
  teamRatingA: number;
  teamRatingB: number;
  expectedA: number;
  expectedB: number;
  multiplier: number;
  ifAWins: OutcomePreview;
  ifBWins: OutcomePreview;
};

function outcome(r: RatingResult, sizeA: number): OutcomePreview {
  return { transferA: r.transferA, perPlayerA: r.changes[0].delta, perPlayerB: r.changes[sizeA].delta };
}

export function previewMatchup(
  sideA: readonly RatedPlayer[],
  sideB: readonly RatedPlayer[],
  params: Pick<EloParams, "kFactor" | "ratingScale">,
  multiplier: number,
  engine: RatingEngine = PHARMA_ELO_V1,
): MatchupPreview {
  const base = { sideA, sideB, kFactor: params.kFactor, ratingScale: params.ratingScale, multiplier };
  const a = engine.calculate({ ...base, winner: "A" });
  const b = engine.calculate({ ...base, winner: "B" });
  return {
    teamRatingA: a.teamRatingA,
    teamRatingB: a.teamRatingB,
    expectedA: a.expectedA,
    expectedB: a.expectedB,
    multiplier,
    ifAWins: outcome(a, sideA.length),
    ifBWins: outcome(b, sideA.length),
  };
}
