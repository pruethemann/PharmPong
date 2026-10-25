import { describe, expect, it } from "vitest";
import { computeAchievements } from "./achievements";
import { DEFAULT_ELO_PARAMS } from "./config";
import { replaySession, type ReplayEntry, type ReplayStep } from "./replay";
import type { Side } from "./types";

type Spec = [sideA: string[], sideB: string[], winner: Side, rated?: boolean];
const history = (...specs: Spec[]): ReplayEntry[] =>
  specs.map(([sideA, sideB, winner, rated = true], i) => ({
    matchId: `m${i + 1}`,
    sequence: i + 1,
    rated,
    winner,
    sideA,
    sideB,
  }));
const steps = (...specs: Spec[]) => replaySession(history(...specs), DEFAULT_ELO_PARAMS).steps;

/** Synthetic one-player trajectory: each value is the rating after an effective 1v1 match. */
function trajectory(userId: string, ratings: number[], startSeq = 1): ReplayStep[] {
  let before = 100;
  return ratings.map((after, i) => {
    const step: ReplayStep = {
      matchId: `${userId}-${i + 1}`,
      sequence: startSeq + i,
      winner: after >= before ? "A" : "B",
      sideA: [userId],
      sideB: ["opponent"],
      rated: true,
      pairKey: "k",
      priorCount: 0,
      multiplier: 1,
      effective: true,
      result: {
        algorithmVersion: "pharmaelo-v1",
        teamRatingA: before,
        teamRatingB: 100,
        expectedA: 0.5,
        expectedB: 0.5,
        multiplier: 1,
        transferA: after - before,
        changes: [
          {
            userId,
            side: "A",
            ratingBefore: before,
            delta: after - before,
            ratingAfter: after,
            expectedScore: 0.5,
            teamSize: 1,
            opponentTeamSize: 1,
          },
        ],
      },
    };
    before = after;
    return step;
  });
}

describe("computeAchievements", () => {
  it("is empty without matches", () => {
    expect(computeAchievements([], 100)).toEqual({
      mostActive: null,
      biggestUpset: null,
      bestComeback: null,
    });
  });

  describe("Most Active", () => {
    it("counts every completed match, friendlies and unrated repeats included", () => {
      const a = computeAchievements(
        steps([["a"], ["b"], "A", false], [["a"], ["c"], "A"], [["a"], ["c"], "A"], [["d"], ["b"], "B"]),
        100,
      );
      expect(a.mostActive).toEqual({ userIds: ["a"], value: 3, sequence: 3, matchId: null });
    });

    it("breaks ties by who reached the count first, then by userId", () => {
      const first = computeAchievements(steps([["b"], ["c"], "A"], [["a"], ["d"], "A"]), 100);
      expect(first.mostActive!.userIds).toEqual(["b"]); // b (and c) reached 1 at sequence 1
      const sameMatch = computeAchievements(steps([["z"], ["y"], "A"]), 100);
      expect(sameMatch.mostActive!.userIds).toEqual(["y"]);
    });
  });

  describe("Biggest Upset", () => {
    it("is the win with the lowest predicted probability, held by the whole winning side", () => {
      // m1: x and y rise to 106, p drops to 88. m2: p (88) beats x (106), a real upset.
      // m3: q (100) beats x+y (average just below 100), so q was the slight favourite.
      const s = steps([["x", "y"], ["p"], "A"], [["p"], ["x"], "A"], [["q"], ["x", "y"], "A"]);
      expect(s[2].result!.expectedA).toBeGreaterThan(0.5);
      const a = computeAchievements(s, 100);
      const p2 = s[1].result!.expectedA;
      expect(a.biggestUpset).toEqual({ userIds: ["p"], value: p2, sequence: 2, matchId: "m2" });
    });

    it("ignores friendlies, unrated repeats and wins of the favourite or equal teams", () => {
      const s = steps(
        [["a"], ["b"], "A"], // equal teams: 0.5 is no upset
        [["b"], ["a"], "A", false], // friendly upset does not count
        [["a"], ["c"], "A"], // a is the favourite now
      );
      expect(computeAchievements(s, 100).biggestUpset).toBeNull();
      const repeats = steps(
        [["a"], ["b"], "A"],
        [["a"], ["b"], "A"],
        [["a"], ["b"], "A"],
        [["a"], ["b"], "B"],
      );
      expect(repeats[3].effective).toBe(false); // 4th meeting is unrated
      expect(computeAchievements(repeats, 100).biggestUpset).toBeNull();
    });

    it("prefers the earlier match on an exact tie", () => {
      // Two symmetric histories produce two upsets with identical probabilities (m3 and m4).
      const tie = steps([["a"], ["b"], "A"], [["c"], ["d"], "A"], [["b"], ["a"], "A"], [["d"], ["c"], "A"]);
      expect(tie[2].result!.expectedA).toBe(tie[3].result!.expectedA);
      expect(computeAchievements(tie, 100).biggestUpset!.matchId).toBe("m3");
    });
  });

  describe("Best Comeback", () => {
    it("measures the rise from the lowest earlier rating, only after a dip below the start", () => {
      const a = computeAchievements(trajectory("u", [90, 120, 60, 70]), 100);
      expect(a.bestComeback).toEqual({ userIds: ["u"], value: 30, sequence: 2, matchId: "u-2" });
    });

    it("does not call a steady climb a comeback", () => {
      expect(computeAchievements(trajectory("u", [110, 130, 105, 135]), 100).bestComeback).toBeNull();
    });

    it("breaks ties by the earlier sequence", () => {
      const s = [...trajectory("v", [80, 100], 1), ...trajectory("u", [80, 100], 3)];
      expect(computeAchievements(s, 100).bestComeback!.userIds).toEqual(["v"]);
    });

    it("breaks ties within the same match by userId (teammates share a trajectory)", () => {
      const s = steps([["v", "u"], ["w", "x"], "B"], [["v", "u"], ["y", "z"], "A"]);
      const c = computeAchievements(s, 100).bestComeback!;
      expect(c.userIds).toEqual(["u"]);
      expect(c.sequence).toBe(2);
    });

    it("works on real replays and never rewards friendlies", () => {
      const s = steps([["a"], ["b"], "B"], [["a"], ["c"], "A"], [["a"], ["b"], "A", false]);
      const c = computeAchievements(s, 100).bestComeback!;
      expect(c.userIds).toEqual(["a"]);
      expect(c.value).toBeCloseTo(
        s[1].result!.changes[0].ratingAfter - s[0].result!.changes[0].ratingAfter,
        12,
      );
      expect(c.matchId).toBe("m2");
    });
  });
});
