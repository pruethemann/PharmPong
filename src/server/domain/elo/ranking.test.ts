import { describe, expect, it } from "vitest";
import { championsOf, rankPlayers } from "./ranking";
import type { PlayerProjection } from "./replay";

const p = (userId: string, rating: number, gamesPlayed = 3): PlayerProjection => ({
  userId,
  rating,
  gamesPlayed,
  wins: gamesPlayed,
  losses: 0,
  lowestRating: Math.min(rating, 100),
  peakRating: Math.max(rating, 100),
  lastSequence: 1,
});

const opts = { minGamesForChampion: 3, initialRating: 100 };

describe("rankPlayers", () => {
  it("sorts by full-precision rating, not by the rounded display value", () => {
    const ranked = rankPlayers([p("x", 112.3), p("y", 112.4), p("z", 90)], opts);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ["y", 1],
      ["x", 2],
      ["z", 3],
    ]);
  });

  it("gives exactly equal ratings the same rank (1, 2, 2, 4)", () => {
    const ranked = rankPlayers([p("a", 120), p("b", 110), p("c", 110), p("d", 100)], opts);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("orders exact ties for display by the tie key, then the userId", () => {
    const names: Record<string, string> = { b: "Anna", c: "Zoe", a: "Anna" };
    const ranked = rankPlayers([p("c", 110), p("b", 110), p("a", 110)], {
      ...opts,
      tieKey: (id) => names[id],
    });
    expect(ranked.map((r) => r.userId)).toEqual(["a", "b", "c"]);
    expect(rankPlayers([p("c", 110), p("b", 110)], opts).map((r) => r.userId)).toEqual(["b", "c"]);
  });

  it("flags provisional players (fewer than the minimum rated games) without moving them", () => {
    const ranked = rankPlayers([p("lucky", 130, 1), p("steady", 120, 5)], opts);
    expect(ranked.map((r) => [r.userId, r.rank, r.provisional, r.eligible])).toEqual([
      ["lucky", 1, true, false],
      ["steady", 2, false, true],
    ]);
    expect(rankPlayers([p("x", 105, 0)], { ...opts, minGamesForChampion: 0 })[0].eligible).toBe(true);
  });

  it("reports the change since the start of the session", () => {
    const ranked = rankPlayers([p("u", 112.5), p("d", 87.25), p("z", 100)], opts);
    expect(ranked.map((r) => r.ratingChange)).toEqual([12.5, 0, -12.75]);
    expect(Object.is(ranked[1].ratingChange, 0)).toBe(true);
  });
});

describe("championsOf", () => {
  it("crowns the best eligible player, skipping provisional leaders", () => {
    const ranked = rankPlayers([p("lucky", 140, 2), p("steady", 125, 4), p("third", 118, 6)], opts);
    expect(championsOf(ranked).map((r) => r.userId)).toEqual(["steady"]);
  });

  it("returns co-champions on a genuine numerical tie and nobody without eligible players", () => {
    const tie = rankPlayers([p("a", 125), p("b", 125), p("c", 120)], opts);
    expect(championsOf(tie).map((r) => r.userId)).toEqual(["a", "b"]);
    expect(championsOf(rankPlayers([p("a", 125, 1)], opts))).toEqual([]);
    expect(championsOf([])).toEqual([]);
  });
});
