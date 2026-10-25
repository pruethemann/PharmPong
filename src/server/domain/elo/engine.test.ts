import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { ELO_ALGORITHM_VERSION } from "./config";
import { expectedScore, MAX_ABS_RATING, PHARMA_ELO_V1, teamRating, type RatingResult } from "./engine";
import type { RatedPlayer, Side } from "./types";

const K = 24;
const D = 100;

const team = (prefix: string, ratings: readonly number[]): RatedPlayer[] =>
  ratings.map((rating, i) => ({ userId: `${prefix}${i + 1}`, rating }));

function calc(a: readonly number[], b: readonly number[], winner: Side, multiplier = 1): RatingResult {
  return PHARMA_ELO_V1.calculate({
    sideA: team("a", a),
    sideB: team("b", b),
    winner,
    kFactor: K,
    ratingScale: D,
    multiplier,
  });
}

const deltasOf = (r: RatingResult, side: Side) =>
  r.changes.filter((c) => c.side === side).map((c) => c.delta);
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const totalChange = (r: RatingResult) => sum(r.changes.map((c) => c.delta));
const byUser = (r: RatingResult) => new Map(r.changes.map((c) => [c.userId, c]));

/** "CODE:field" of a thrown DomainError, "OK" if nothing was thrown. */
function errorOf(fn: () => unknown): string {
  try {
    fn();
    return "OK";
  } catch (e) {
    if (!isDomainError(e)) throw e;
    return `${e.code}:${String((e.details as { field?: string } | undefined)?.field)}`;
  }
}

describe("teamRating (arithmetic mean, spec §3.2)", () => {
  it("matches the spec examples", () => {
    expect(teamRating([120])).toBe(120);
    expect(teamRating([100, 140])).toBe(120);
    expect(teamRating([80, 100, 120, 140])).toBe(110);
  });

  it("averages instead of summing, so larger teams are not favoured by size", () => {
    expect(teamRating([100, 100, 100, 100])).toBe(teamRating([100]));
  });

  it("is bit-identical under every permutation", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 4 }),
        (ratings) => {
          const reference = teamRating(ratings);
          expect(teamRating([...ratings].reverse())).toBe(reference);
          expect(teamRating([...ratings.slice(1), ratings[0]])).toBe(reference);
        },
      ),
    );
  });

  it("rejects an empty team", () => {
    expect(errorOf(() => teamRating([]))).toBe("VALIDATION:roster");
  });
});

describe("expectedScore (logistic expectation, spec §3.3)", () => {
  it("gives 50% for equal ratings", () => {
    expect(expectedScore(100, 100, D)).toBe(0.5);
    expect(expectedScore(137.5, 137.5, 400)).toBe(0.5);
  });

  it("gives the underdog the documented probability", () => {
    expect(expectedScore(80, 120, D)).toBeCloseTo(0.2847, 4);
    expect(expectedScore(120, 80, D)).toBeCloseTo(0.7153, 4);
    // Chess scale for comparison: 400 points behind is a 1:10 underdog.
    expect(expectedScore(1200, 1600, 400)).toBeCloseTo(1 / 11, 12);
  });

  it("is symmetric and increases with the rating difference", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 10, max: 1000, noNaN: true }),
        (a, b, d) => {
          const e = expectedScore(a, b, d);
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
          expect(e + expectedScore(b, a, d)).toBeCloseTo(1, 12);
          if (a > b) expect(e).toBeGreaterThanOrEqual(0.5);
          expect(expectedScore(a + 10, b, d)).toBeGreaterThanOrEqual(e);
        },
      ),
    );
  });
});

describe("spec example A: equal 2v2", () => {
  const r = calc([100, 100], [100, 100], "A");

  it("transfers exactly K/2 to the winners and splits it equally", () => {
    expect(r.expectedA).toBe(0.5);
    expect(r.expectedB).toBe(0.5);
    expect(r.transferA).toBe(12);
    expect(deltasOf(r, "A")).toEqual([6, 6]);
    expect(deltasOf(r, "B")).toEqual([-6, -6]);
    expect(r.changes.map((c) => c.ratingAfter)).toEqual([106, 106, 94, 94]);
    expect(totalChange(r)).toBe(0);
  });

  it("records the algorithm version and team sizes", () => {
    expect(r.algorithmVersion).toBe(ELO_ALGORITHM_VERSION);
    expect(PHARMA_ELO_V1.version).toBe("pharmaelo-v1");
    expect(r.changes.every((c) => c.teamSize === 2 && c.opponentTeamSize === 2)).toBe(true);
  });
});

describe("spec example B: equal 1v4", () => {
  it("the solo winner gains 12, each of the four losers loses 3", () => {
    const r = calc([100], [100, 100, 100, 100], "A");
    expect(deltasOf(r, "A")).toEqual([12]);
    expect(deltasOf(r, "B")).toEqual([-3, -3, -3, -3]);
    expect(totalChange(r)).toBe(0);
  });

  it("the solo loser loses 12, each of the four winners gains 3", () => {
    const r = calc([100], [100, 100, 100, 100], "B");
    expect(deltasOf(r, "A")).toEqual([-12]);
    expect(deltasOf(r, "B")).toEqual([3, 3, 3, 3]);
    expect(totalChange(r)).toBe(0);
    expect(r.changes[0]).toMatchObject({ teamSize: 1, opponentTeamSize: 4 });
    expect(r.changes[1]).toMatchObject({ teamSize: 4, opponentTeamSize: 1 });
  });
});

describe("spec example C: upset victory (80 vs 120, 2v2)", () => {
  const upset = calc([70, 90], [110, 130], "A");
  const expected = calc([70, 90], [110, 130], "B");

  it("matches the documented numbers", () => {
    expect(upset.teamRatingA).toBe(80);
    expect(upset.teamRatingB).toBe(120);
    expect(upset.expectedA).toBeCloseTo(0.2847, 4);
    expect(upset.transferA).toBeCloseTo(17.17, 2);
    for (const d of deltasOf(upset, "A")) expect(d).toBeCloseTo(8.58, 2);
    for (const d of deltasOf(upset, "B")) expect(d).toBeCloseTo(-8.58, 2);
    expect(Math.abs(totalChange(upset))).toBeLessThan(1e-12);
  });

  it("pays the underdog more than the favourite gets for an expected win", () => {
    expect(deltasOf(upset, "A")[0]).toBeGreaterThan(deltasOf(expected, "B")[0]);
    expect(deltasOf(expected, "B")[0]).toBeCloseTo(3.417, 3);
  });
});

describe("example D: every team-size combination 1..4 × 1..4", () => {
  const pool = [103.25, 96.5, 121.125, 88.75];
  for (let nA = 1; nA <= 4; nA++) {
    for (let nB = 1; nB <= 4; nB++) {
      for (const winner of ["A", "B"] as const) {
        it(`${nA}v${nB}, ${winner} wins`, () => {
          const a = pool.slice(0, nA);
          const b = pool.slice(4 - nB).map((x) => x + 7);
          const r = calc(a, b, winner);
          // valid probability
          expect(r.expectedA).toBeGreaterThan(0);
          expect(r.expectedA).toBeLessThan(1);
          expect(r.expectedA + r.expectedB).toBe(1);
          // signs
          const win = deltasOf(r, winner);
          const lose = deltasOf(r, winner === "A" ? "B" : "A");
          expect(win.every((d) => d > 0)).toBe(true);
          expect(lose.every((d) => d < 0)).toBe(true);
          // equal distribution inside each side, sized by the side
          const dA = deltasOf(r, "A");
          const dB = deltasOf(r, "B");
          expect(new Set(dA).size).toBe(1);
          expect(new Set(dB).size).toBe(1);
          expect(dA[0] * nA).toBeCloseTo(r.transferA, 12);
          expect(dB[0] * nB).toBeCloseTo(-r.transferA, 12);
          // zero-sum
          expect(Math.abs(totalChange(r))).toBeLessThan(1e-12);
          // roster order does not matter (bit-identical per player)
          const reversed = PHARMA_ELO_V1.calculate({
            sideA: team("a", a).reverse(),
            sideB: team("b", b).reverse(),
            winner,
            kFactor: K,
            ratingScale: D,
            multiplier: 1,
          });
          const ref = byUser(r);
          for (const c of reversed.changes) expect(c).toEqual(ref.get(c.userId));
          // duplicate players are rejected for this shape too
          const dup = team("a", a);
          expect(
            errorOf(() =>
              PHARMA_ELO_V1.calculate({
                sideA: dup,
                sideB: [dup[0], ...team("b", b).slice(1)],
                winner,
                kFactor: K,
                ratingScale: D,
                multiplier: 1,
              }),
            ),
          ).toBe("VALIDATION:roster");
        });
      }
    }
  }
});

// ─── Properties ─────────────────────────────────────────────────────────────

const ratingArb = fc.double({ min: -500, max: 1500, noNaN: true });
const sideArb = (prefix: string) =>
  fc
    .array(ratingArb, { minLength: 1, maxLength: 4 })
    .map((rs) => rs.map((rating, i) => ({ userId: `${prefix}${i}`, rating })));
const inputArb = fc.record({
  sideA: sideArb("a"),
  sideB: sideArb("b"),
  winner: fc.constantFrom<Side>("A", "B"),
  kFactor: fc.double({ min: 0.5, max: 100, noNaN: true }),
  ratingScale: fc.double({ min: 10, max: 1000, noNaN: true }),
  multiplier: fc.double({ min: 0, max: 1, noNaN: true }),
});

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (seed * (i + 7)) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("rating properties (fast-check)", () => {
  it("conserves rating points: every match is zero-sum", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(Math.abs(totalChange(PHARMA_ELO_V1.calculate(input)))).toBeLessThanOrEqual(1e-9);
      }),
    );
  });

  it("gives teammates identical changes and never moves a loser up or a winner down", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = PHARMA_ELO_V1.calculate(input);
        const loser = input.winner === "A" ? "B" : "A";
        expect(new Set(deltasOf(r, "A")).size).toBe(1);
        expect(new Set(deltasOf(r, "B")).size).toBe(1);
        expect(deltasOf(r, input.winner).every((d) => d >= 0)).toBe(true);
        expect(deltasOf(r, loser).every((d) => d <= 0)).toBe(true);
        const winnerExpected = input.winner === "A" ? r.expectedA : r.expectedB;
        // Strictly positive unless the probability saturates or the multiplier is so tiny that the
        // product underflows (fast-check probes denormals such as 5e-324; real multipliers are ≥ 0.01).
        if (input.multiplier >= 1e-9 && winnerExpected < 1) {
          expect(deltasOf(r, input.winner).every((d) => d > 0)).toBe(true);
        }
        for (const c of r.changes) expect(c.ratingAfter).toBe(c.ratingBefore + c.delta);
        expect(r.expectedA).toBeGreaterThanOrEqual(0);
        expect(r.expectedA).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("does not depend on roster order (bit-identical)", () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 97 }), (input, seed) => {
        const r = PHARMA_ELO_V1.calculate(input);
        const s = PHARMA_ELO_V1.calculate({
          ...input,
          sideA: shuffled(input.sideA, seed),
          sideB: shuffled(input.sideB, seed + 3),
        });
        expect(s.teamRatingA).toBe(r.teamRatingA);
        expect(s.teamRatingB).toBe(r.teamRatingB);
        expect(s.transferA).toBe(r.transferA);
        const ref = byUser(r);
        for (const c of s.changes) expect(c).toEqual(ref.get(c.userId));
      }),
    );
  });

  it("is mirror-symmetric: swapping the sides swaps the outcome", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = PHARMA_ELO_V1.calculate(input);
        const m = PHARMA_ELO_V1.calculate({
          ...input,
          sideA: input.sideB,
          sideB: input.sideA,
          winner: input.winner === "A" ? "B" : "A",
        });
        expect(m.expectedB).toBeCloseTo(r.expectedA, 10);
        expect(m.transferA).toBeCloseTo(-r.transferA, 9);
        const ref = byUser(r);
        for (const c of m.changes) expect(c.delta).toBeCloseTo(ref.get(c.userId)!.delta, 9);
      }),
    );
  });

  it("pays an upset more than an expected win", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const asA = PHARMA_ELO_V1.calculate({ ...input, winner: "A" });
        const asB = PHARMA_ELO_V1.calculate({ ...input, winner: "B" });
        if (input.multiplier === 0 || asA.teamRatingA === asA.teamRatingB) return;
        const aIsUnderdog = asA.teamRatingA < asA.teamRatingB;
        const underdogWin = Math.abs(aIsUnderdog ? asA.transferA : asB.transferA);
        const favouriteWin = Math.abs(aIsUnderdog ? asB.transferA : asA.transferA);
        expect(underdogWin).toBeGreaterThanOrEqual(favouriteWin);
      }),
    );
  });

  it("scales the transfer linearly with the repeat multiplier (exactly)", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const full = PHARMA_ELO_V1.calculate({ ...input, multiplier: 1 });
        const part = PHARMA_ELO_V1.calculate(input);
        const scaled = full.transferA * input.multiplier;
        expect(part.transferA).toBe(scaled === 0 ? 0 : scaled);
      }),
    );
  });
});

describe("multipliers, friendlies and cups", () => {
  it("halves the transfer at 50% and moves nobody at 0%", () => {
    const half = calc([100, 100], [100, 100], "A", 0.5);
    expect(deltasOf(half, "A")).toEqual([3, 3]);
    expect(deltasOf(half, "B")).toEqual([-3, -3]);
    const none = calc([100, 100], [100, 100], "A", 0);
    expect(none.transferA).toBe(0);
    expect(none.changes.every((c) => Object.is(c.delta, 0) && c.ratingAfter === c.ratingBefore)).toBe(true);
  });

  it("ignores everything except ratings, winner and parameters (cup margins have no input)", () => {
    const base = {
      sideA: team("a", [100, 104]),
      sideB: team("b", [97]),
      winner: "A" as const,
      kFactor: K,
      ratingScale: D,
      multiplier: 1,
    };
    const withCups = { ...base, cupsRemainingA: 9, cupsRemainingB: 0 };
    expect(PHARMA_ELO_V1.calculate(withCups)).toEqual(PHARMA_ELO_V1.calculate(base));
  });

  it("keeps full decimal precision (no rounding anywhere)", () => {
    const r = calc([100.123456789], [99.987654321], "A");
    const expectedA = 1 / (1 + 10 ** ((99.987654321 - 100.123456789) / D));
    expect(r.expectedA).toBe(expectedA);
    expect(r.changes[0].delta).toBe(K * (1 - expectedA));
    expect(r.changes[0].ratingAfter).toBe(100.123456789 + K * (1 - expectedA));
    expect(Number.isInteger(r.changes[0].delta * 1000)).toBe(false);
  });
});

describe("extreme rating differences", () => {
  it("saturates the probability without NaN", () => {
    const fav = calc([1e6], [-1e6], "A");
    expect(fav.expectedA).toBe(1);
    expect(fav.transferA).toBe(0);
    const shock = calc([1e6], [-1e6], "B");
    expect(shock.transferA).toBe(-24);
    expect(deltasOf(shock, "B")).toEqual([24]);
    for (const r of [fav, shock, calc([-1e8, 1e8], [5e8], "A")]) {
      expect(r.changes.every((c) => Number.isFinite(c.delta) && Number.isFinite(c.ratingAfter))).toBe(true);
    }
  });

  it("accepts ratings just inside ±1e9 and rejects the bound", () => {
    expect(errorOf(() => calc([MAX_ABS_RATING - 1], [0], "A"))).toBe("OK");
    expect(errorOf(() => calc([MAX_ABS_RATING], [0], "A"))).toBe("VALIDATION:rating");
    expect(errorOf(() => calc([0], [-MAX_ABS_RATING], "A"))).toBe("VALIDATION:rating");
  });
});

describe("invalid inputs", () => {
  const ok = {
    sideA: team("a", [100]),
    sideB: team("b", [100]),
    winner: "A" as Side,
    kFactor: K,
    ratingScale: D,
    multiplier: 1,
  };
  const run = (patch: Record<string, unknown>) => errorOf(() => PHARMA_ELO_V1.calculate({ ...ok, ...patch }));

  it("rejects non-finite ratings", () => {
    for (const rating of [Number.NaN, Infinity, -Infinity]) {
      expect(run({ sideA: [{ userId: "a1", rating }] })).toBe("VALIDATION:rating");
    }
  });

  it("rejects empty, oversized and invalid rosters", () => {
    expect(run({ sideA: [] })).toBe("VALIDATION:roster");
    expect(run({ sideB: team("b", [1, 2, 3, 4, 5]) })).toBe("VALIDATION:roster");
    expect(run({ sideA: [{ userId: "", rating: 100 }] })).toBe("VALIDATION:roster");
  });

  it("rejects duplicate participants within a side and across sides", () => {
    expect(
      run({
        sideA: [
          { userId: "x", rating: 100 },
          { userId: "x", rating: 100 },
        ],
      }),
    ).toBe("VALIDATION:roster");
    expect(run({ sideA: [{ userId: "x", rating: 100 }], sideB: [{ userId: "x", rating: 90 }] })).toBe(
      "VALIDATION:roster",
    );
  });

  it("rejects draws and unknown winners", () => {
    expect(run({ winner: "DRAW" })).toBe("VALIDATION:winner");
    expect(run({ winner: undefined })).toBe("VALIDATION:winner");
  });

  it("rejects invalid K, D and multipliers", () => {
    for (const kFactor of [0, -1, Number.NaN, Infinity]) expect(run({ kFactor })).toBe("VALIDATION:kFactor");
    for (const ratingScale of [0, -100, Number.NaN, Infinity]) {
      expect(run({ ratingScale })).toBe("VALIDATION:ratingScale");
    }
    for (const multiplier of [-0.1, 1.1, Number.NaN, Infinity]) {
      expect(run({ multiplier })).toBe("VALIDATION:multiplier");
    }
  });

  it("explains errors in Swiss German", () => {
    try {
      PHARMA_ELO_V1.calculate({ ...ok, kFactor: 0 });
    } catch (e) {
      expect((e as Error).message).toMatch(/K-Faktor/);
      expect((e as Error).message).not.toMatch(/ß/);
    }
  });
});
