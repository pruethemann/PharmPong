import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { DEFAULT_ELO_PARAMS } from "./config";
import { expectedScore, PHARMA_ELO_V1, type RatingEngine } from "./engine";
import {
  applyMatch,
  compareProjections,
  conservationError,
  createReplayState,
  projectionDigest,
  projectionsOf,
  ratingOf,
  replaySession,
  type ReplayEntry,
} from "./replay";
import type { EloParams, Side } from "./types";

const P = DEFAULT_ELO_PARAMS;

type Spec = [sideA: string[], sideB: string[], winner: Side, rated?: boolean];

/** Entries with sequences 1..n in the given order. */
const history = (...specs: Spec[]): ReplayEntry[] =>
  specs.map(([sideA, sideB, winner, rated = true], i) => ({
    matchId: `m${i + 1}`,
    sequence: i + 1,
    rated,
    winner,
    sideA,
    sideB,
  }));

const ratings = (entries: readonly ReplayEntry[], params: EloParams = P) =>
  Object.fromEntries(projectionsOf(replaySession(entries, params).state).map((p) => [p.userId, p.rating]));

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "OK";
  } catch (e) {
    if (!isDomainError(e)) throw e;
    return `${e.code}:${String((e.details as { field?: string }).field)}`;
  }
}

describe("replaySession basics", () => {
  it("starts everybody at the initial rating of 100", () => {
    const { state, steps } = replaySession([], P);
    expect(steps).toEqual([]);
    expect(projectionsOf(state)).toEqual([]);
    expect(ratingOf(state, "nobody", P.initialRating)).toBe(100);
  });

  it("applies one match and tracks games, wins, losses, low and peak", () => {
    const { state } = replaySession(history([["a", "b"], ["c", "d"], "A"]), P);
    expect(projectionsOf(state)).toEqual([
      {
        userId: "a",
        rating: 106,
        gamesPlayed: 1,
        wins: 1,
        losses: 0,
        lowestRating: 100,
        peakRating: 106,
        lastSequence: 1,
      },
      {
        userId: "b",
        rating: 106,
        gamesPlayed: 1,
        wins: 1,
        losses: 0,
        lowestRating: 100,
        peakRating: 106,
        lastSequence: 1,
      },
      {
        userId: "c",
        rating: 94,
        gamesPlayed: 1,
        wins: 0,
        losses: 1,
        lowestRating: 94,
        peakRating: 100,
        lastSequence: 1,
      },
      {
        userId: "d",
        rating: 94,
        gamesPlayed: 1,
        wins: 0,
        losses: 1,
        lowestRating: 94,
        peakRating: 100,
        lastSequence: 1,
      },
    ]);
  });

  it("feeds each match the ratings produced by the previous ones", () => {
    const { steps } = replaySession(history([["a", "b"], ["c", "d"], "A"], [["a"], ["c"], "B"]), P);
    const second = steps[1].result!;
    expect(second.changes.map((c) => c.ratingBefore)).toEqual([106, 94]);
    expect(second.expectedA).toBe(expectedScore(106, 94, 100));
    expect(second.changes[1].delta).toBeGreaterThan(12); // c beat a favourite
  });

  it("orders by confirmation sequence, never by input order", () => {
    const h = history([["a"], ["b"], "A"], [["a"], ["c"], "B"], [["b"], ["c"], "A"]);
    const shuffled = [h[2], h[0], h[1]];
    expect(projectionDigest(replaySession(shuffled, P).state)).toBe(
      projectionDigest(replaySession(h, P).state),
    );
    // Sequences only need to increase; gaps (voided matches) change nothing but lastSequence.
    const gappy = h.map((e, i) => ({ ...e, sequence: (i + 1) * 10 }));
    const withoutSeq = (entries: ReplayEntry[]) =>
      projectionsOf(replaySession(entries, P).state).map(({ lastSequence: _seq, ...rest }) => rest);
    expect(withoutSeq(gappy)).toEqual(withoutSeq(h));
  });

  it("rejects duplicate or invalid sequences, invalid rosters and invalid parameters", () => {
    const h = history([["a"], ["b"], "A"], [["a"], ["c"], "B"]);
    expect(codeOf(() => replaySession([h[0], { ...h[1], sequence: 1 }], P))).toBe("VALIDATION:sequence");
    expect(codeOf(() => replaySession([{ ...h[0], sequence: 0 }], P))).toBe("VALIDATION:sequence");
    expect(codeOf(() => replaySession([{ ...h[0], sequence: 1.5 }], P))).toBe("VALIDATION:sequence");
    const state = createReplayState();
    applyMatch(state, h[1], P);
    expect(codeOf(() => applyMatch(state, h[0], P))).toBe("VALIDATION:sequence");
    expect(codeOf(() => replaySession(history([["a"], ["a"], "A"]), P))).toBe("VALIDATION:roster");
    expect(codeOf(() => replaySession(h, { ...P, kFactor: 0 }))).toBe("VALIDATION:kFactor");
  });
});

describe("friendlies and the repeat-match safeguard", () => {
  it("records friendlies without rating them or counting them as repeats", () => {
    const { state, steps } = replaySession(
      history([["a"], ["b"], "A", false], [["a"], ["b"], "B", false], [["a"], ["b"], "A"]),
      P,
    );
    expect(steps.slice(0, 2).map((s) => [s.effective, s.multiplier, s.result])).toEqual([
      [false, 0, null],
      [false, 0, null],
    ]);
    expect(steps[2]).toMatchObject({ priorCount: 0, multiplier: 1, effective: true });
    expect(projectionsOf(state).map((p) => [p.userId, p.gamesPlayed])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("applies 100%, 100%, 50%, 0%, 0% to identical rosters, also with swapped sides", () => {
    const { state, steps } = replaySession(
      history(
        [["a", "b"], ["c"], "A"],
        [["c"], ["b", "a"], "B"],
        [["a", "b"], ["c"], "A"],
        [["b", "a"], ["c"], "B"],
        [["c"], ["a", "b"], "A"],
      ),
      P,
    );
    expect(steps.map((s) => s.multiplier)).toEqual([1, 1, 0.5, 0, 0]);
    expect(steps.map((s) => s.priorCount)).toEqual([0, 1, 2, 3, 4]);
    expect(steps.map((s) => s.effective)).toEqual([true, true, true, false, false]);
    expect(new Set(steps.map((s) => s.pairKey)).size).toBe(1);
    // The unrated repeats are calculated (for display) but move nobody and are no rated games.
    expect(steps[3].result!.changes.every((c) => c.delta === 0)).toBe(true);
    const c = projectionsOf(state).find((p) => p.userId === "c")!;
    expect(c.gamesPlayed).toBe(3);
    expect(c.lastSequence).toBe(3);
    // Third meeting: the 50% applies to the total before it is split.
    expect(steps[2].result!.transferA).toBeCloseTo(0.5 * 24 * (1 - steps[2].result!.expectedA), 12);
  });

  it("treats a changed roster as a new pairing", () => {
    const { steps } = replaySession(
      history(
        [["a", "b"], ["c"], "A"],
        [["a", "b"], ["c"], "A"],
        [["a", "b"], ["c"], "A"],
        [["a"], ["c"], "A"],
      ),
      P,
    );
    expect(steps.map((s) => s.multiplier)).toEqual([1, 1, 0.5, 1]);
  });

  it("can be disabled", () => {
    const h = history([["a"], ["b"], "A"], [["a"], ["b"], "A"], [["a"], ["b"], "A"], [["a"], ["b"], "A"]);
    expect(replaySession(h, { ...P, repeatMultipliers: [1] }).steps.map((s) => s.multiplier)).toEqual([
      1, 1, 1, 1,
    ]);
  });
});

describe("corrections need a full replay (spec §3.8, §11.2)", () => {
  // Six players, mixed team sizes, 12 confirmed matches.
  const base = history(
    [["anna", "ben"], ["carla", "dario"], "A"],
    [["anna"], ["eva", "finn"], "B"], // match 2: corrected below
    [["ben", "carla"], ["dario", "eva"], "A"],
    [["finn"], ["anna"], "A"],
    [["anna", "dario", "eva"], ["ben"], "B"],
    [["carla"], ["finn", "ben"], "A"],
    [["eva"], ["dario"], "A"],
    [["anna", "finn"], ["carla", "ben", "dario", "eva"], "A"],
    [["ben"], ["carla"], "B"],
    [["dario", "finn"], ["anna", "eva"], "B"],
    [["carla", "eva"], ["ben", "finn"], "A"],
    [["anna"], ["dario"], "A"],
  );
  const corrected = base.map((e) => (e.matchId === "m2" ? { ...e, winner: "A" as const } : e));
  const before = replaySession(base, P);
  const after = replaySession(corrected, P);

  it("leaves earlier matches untouched and recomputes the corrected one", () => {
    expect(after.steps[0]).toEqual(before.steps[0]);
    const b2 = before.steps[1].result!;
    const a2 = after.steps[1].result!;
    expect(a2.changes.map((c) => c.ratingBefore)).toEqual(b2.changes.map((c) => c.ratingBefore));
    expect(a2.transferA).toBeGreaterThan(0);
    expect(b2.transferA).toBeLessThan(0);
  });

  it("changes downstream matches that depended on the corrected ratings", () => {
    const changedDownstream = after.steps
      .slice(2)
      .filter((s, i) => JSON.stringify(s.result) !== JSON.stringify(before.steps[i + 2].result));
    expect(changedDownstream.length).toBeGreaterThan(0);
    // Match 4 involves anna and finn again; its inputs differ, so its output must differ.
    expect(after.steps[3].result!.changes.map((c) => c.ratingBefore)).not.toEqual(
      before.steps[3].result!.changes.map((c) => c.ratingBefore),
    );
    expect(projectionDigest(after.state)).not.toBe(projectionDigest(before.state));
  });

  it("differs from naively reversing and re-applying only the corrected match", () => {
    const old2 = new Map(before.steps[1].result!.changes.map((c) => [c.userId, c.delta]));
    const new2 = new Map(after.steps[1].result!.changes.map((c) => [c.userId, c.delta]));
    const naive = projectionsOf(before.state).map((p) => ({
      userId: p.userId,
      rating: p.rating - (old2.get(p.userId) ?? 0) + (new2.get(p.userId) ?? 0),
    }));
    const replayed = new Map(projectionsOf(after.state).map((p) => [p.userId, p.rating]));
    const maxGap = Math.max(...naive.map((p) => Math.abs(p.rating - replayed.get(p.userId)!)));
    expect(maxGap).toBeGreaterThan(0.01);
  });

  it("is reproducible: replaying again yields bit-identical results", () => {
    const again = replaySession(corrected, P);
    expect(projectionDigest(again.state)).toBe(projectionDigest(after.state));
    expect(again.steps).toEqual(after.steps);
  });

  it("keeps rating points conserved before and after the correction", () => {
    expect(conservationError(projectionsOf(before.state), 100)).toBeLessThan(1e-9);
    expect(conservationError(projectionsOf(after.state), 100)).toBeLessThan(1e-9);
  });

  it("handles voided matches consistently: they leave the sequence and the repeat count", () => {
    const h = history([["a"], ["b"], "A"], [["a"], ["b"], "B"], [["a"], ["b"], "A"]);
    expect(replaySession(h, P).steps.map((s) => s.multiplier)).toEqual([1, 1, 0.5]);
    const voidedSecond = h.filter((e) => e.matchId !== "m2");
    expect(replaySession(voidedSecond, P).steps.map((s) => s.multiplier)).toEqual([1, 1]);
  });

  it("recounts repeats after a roster correction and after a rated/friendly correction", () => {
    const h = history(
      [["a", "b"], ["c", "d"], "A"],
      [["a", "b"], ["c", "d"], "A"],
      [["a", "b"], ["c", "d"], "A"],
    );
    expect(replaySession(h, P).steps[2].multiplier).toBe(0.5);
    const rosterFixed = h.map((e) => (e.matchId === "m2" ? { ...e, sideB: ["c", "e"] } : e));
    expect(replaySession(rosterFixed, P).steps[2].multiplier).toBe(1);
    const madeFriendly = h.map((e) => (e.matchId === "m1" ? { ...e, rated: false } : e));
    expect(replaySession(madeFriendly, P).steps.map((s) => s.multiplier)).toEqual([0, 1, 1]);
  });

  it("recomputes everything when the rating parameters change", () => {
    const k32 = ratings(base, { ...P, kFactor: 32 });
    const k24 = ratings(base);
    expect(k32.anna).not.toBe(k24.anna);
    // Conservation holds for any parameters.
    expect(Math.abs(Object.values(k32).reduce((s, r) => s + (r - 100), 0))).toBeLessThan(1e-9);
  });
});

// ─── Properties ─────────────────────────────────────────────────────────────

const PLAYERS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
const matchArb = fc.uniqueArray(fc.constantFrom(...PLAYERS), { minLength: 2, maxLength: 8 }).chain((ids) =>
  fc
    .record({
      cut: fc.integer({ min: Math.max(1, ids.length - 4), max: Math.min(4, ids.length - 1) }),
      winner: fc.constantFrom<Side>("A", "B"),
      friendly: fc.integer({ min: 0, max: 4 }).map((n) => n === 0), // about 20% friendlies
    })
    .map((r) => ({
      sideA: ids.slice(0, r.cut),
      sideB: ids.slice(r.cut),
      winner: r.winner,
      rated: !r.friendly,
    })),
);
// Sequences with gaps (as after voided matches).
const historyArb = fc
  .array(matchArb, { maxLength: 30 })
  .map((ms) => ms.map((m, i): ReplayEntry => ({ ...m, matchId: `m${i}`, sequence: 3 * i + 1 })));
const paramsArb = fc.record({
  initialRating: fc.constantFrom(0, 100, 1000),
  kFactor: fc.double({ min: 1, max: 100, noNaN: true }),
  ratingScale: fc.double({ min: 10, max: 1000, noNaN: true }),
  repeatMultipliers: fc.constantFrom([1, 1, 0.5, 0], [1], [1, 0.25], [0.5]),
});

describe("replay properties (fast-check)", () => {
  it("full replay equals applying the last match to the replayed prefix", () => {
    fc.assert(
      fc.property(historyArb, paramsArb, (h, params) => {
        if (h.length === 0) return;
        const prefix = replaySession(h.slice(0, -1), params);
        const step = applyMatch(prefix.state, h[h.length - 1], params);
        const full = replaySession(h, params);
        expect(projectionDigest(prefix.state)).toBe(projectionDigest(full.state));
        expect(step).toEqual(full.steps[full.steps.length - 1]);
      }),
    );
  });

  it("is deterministic, conserves points and keeps consistent counters and chains", () => {
    fc.assert(
      fc.property(historyArb, paramsArb, (h, params) => {
        const one = replaySession(h, params);
        const two = replaySession(h, params);
        expect(projectionDigest(two.state)).toBe(projectionDigest(one.state));
        const players = projectionsOf(one.state);
        expect(conservationError(players, params.initialRating)).toBeLessThan(1e-9);
        for (const p of players) {
          expect(p.wins + p.losses).toBe(p.gamesPlayed);
          expect(Number.isFinite(p.rating)).toBe(true);
          expect(p.lowestRating).toBeLessThanOrEqual(Math.min(p.rating, params.initialRating));
          expect(p.peakRating).toBeGreaterThanOrEqual(Math.max(p.rating, params.initialRating));
        }
        // Every change starts from the player's rating after their previous effective match.
        const current = new Map<string, number>();
        for (const s of one.steps) {
          if (!s.result) continue;
          for (const c of s.result.changes) {
            expect(c.ratingBefore).toBe(current.get(c.userId) ?? params.initialRating);
            if (s.effective) current.set(c.userId, c.ratingAfter);
          }
        }
      }),
    );
  });
});

describe("compareProjections and digests", () => {
  const { state } = replaySession(history([["a"], ["b"], "A"], [["b"], ["c"], "A"]), P);
  const stored = projectionsOf(state);

  it("reports no drift for identical projections", () => {
    expect(compareProjections(stored, projectionsOf(state))).toEqual({
      maxDeviation: 0,
      mismatchedUserIds: [],
    });
  });

  it("tolerates last-bit differences across runtimes but reports their size", () => {
    const drifted = stored.map((p) => (p.userId === "b" ? { ...p, rating: p.rating + 1e-12 } : p));
    const cmp = compareProjections(stored, drifted);
    expect(cmp.mismatchedUserIds).toEqual([]);
    expect(cmp.maxDeviation).toBeGreaterThan(0);
    // The exact digest still sees the difference (17 significant digits distinguish every double).
    const driftedState = { ...state, players: new Map(drifted.map((p) => [p.userId, p])) };
    expect(projectionDigest(driftedState)).not.toBe(projectionDigest(state));
  });

  it("flags missing players, counter differences and real deviations", () => {
    const cmp = compareProjections(stored, [
      { ...stored[0], rating: stored[0].rating + 0.5 },
      { ...stored[1], gamesPlayed: 99 },
    ]);
    expect(cmp.maxDeviation).toBe(Infinity);
    expect(cmp.mismatchedUserIds).toEqual(["a", "b", "c"]);
  });

  it("lists projections sorted by userId and returns copies", () => {
    const list = projectionsOf(state);
    expect(list.map((p) => p.userId)).toEqual(["a", "b", "c"]);
    list[0].rating = -1;
    expect(ratingOf(state, "a", 100)).not.toBe(-1);
  });
});

describe("RatingEngine extension point", () => {
  it("replays with any engine implementing the interface", () => {
    const flat: RatingEngine = {
      version: "flat-test",
      calculate: (input) => {
        const r = PHARMA_ELO_V1.calculate(input);
        return { ...r, algorithmVersion: "flat-test" };
      },
    };
    const { steps } = replaySession(history([["a"], ["b"], "A"]), P, flat);
    expect(steps[0].result!.algorithmVersion).toBe("flat-test");
  });
});
