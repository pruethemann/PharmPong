import { describe, expect, it } from "vitest";
import { DEFAULT_ELO_PARAMS } from "./config";
import { PHARMA_ELO_V1 } from "./engine";
import { previewMatchup } from "./preview";
import type { RatedPlayer } from "./types";

const team = (prefix: string, ratings: number[]): RatedPlayer[] =>
  ratings.map((rating, i) => ({ userId: `${prefix}${i}`, rating }));

describe("previewMatchup (spec §3.7)", () => {
  it("shows averages, probabilities and both outcomes for an equal 2v2", () => {
    const p = previewMatchup(team("a", [90, 110]), team("b", [100, 100]), DEFAULT_ELO_PARAMS, 1);
    expect(p).toMatchObject({
      teamRatingA: 100,
      teamRatingB: 100,
      expectedA: 0.5,
      expectedB: 0.5,
      multiplier: 1,
    });
    expect(p.ifAWins).toEqual({ transferA: 12, perPlayerA: 6, perPlayerB: -6 });
    expect(p.ifBWins).toEqual({ transferA: -12, perPlayerA: -6, perPlayerB: 6 });
  });

  it("reflects uneven team sizes and the repeat multiplier", () => {
    const p = previewMatchup(team("a", [100]), team("b", [100, 100, 100, 100]), DEFAULT_ELO_PARAMS, 0.5);
    expect(p.ifAWins).toEqual({ transferA: 6, perPlayerA: 6, perPlayerB: -1.5 });
    expect(p.ifBWins).toEqual({ transferA: -6, perPlayerA: -6, perPlayerB: 1.5 });
  });

  it("is exactly what the engine computes at confirmation for the same ratings", () => {
    const a = team("a", [131.7, 88.2]);
    const b = team("b", [101.9]);
    const p = previewMatchup(a, b, DEFAULT_ELO_PARAMS, 1);
    const real = PHARMA_ELO_V1.calculate({
      sideA: a,
      sideB: b,
      winner: "B",
      kFactor: 24,
      ratingScale: 100,
      multiplier: 1,
    });
    expect(p.ifBWins.perPlayerA).toBe(real.changes[0].delta);
    expect(p.ifBWins.perPlayerB).toBe(real.changes[2].delta);
    expect(p.expectedA).toBe(real.expectedA);
  });

  it("does not mutate the inputs", () => {
    const a = team("a", [100, 120]);
    const snapshot = JSON.stringify(a);
    previewMatchup(a, team("b", [95]), DEFAULT_ELO_PARAMS, 1);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});
