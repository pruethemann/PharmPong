import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { cupStats, forfeitResult, validateResult, type ResultInput } from "./result-rules";

const base: ResultInput = {
  homeTeamId: "h",
  awayTeamId: "a",
  winnerTeamId: "h",
  homeCupsRemaining: 3,
  awayCupsRemaining: 0,
  endType: "REGULAR",
};

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe("INVALID_RESULT");
    return (e as DomainError).details?.reason as string;
  }
  return undefined;
}

describe("validateResult", () => {
  it("accepts a regular win (home and away)", () => {
    expect(validateResult(base)).toEqual({
      winnerTeamId: "h",
      homeCupsRemaining: 3,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    expect(
      validateResult({ ...base, winnerTeamId: "a", homeCupsRemaining: 0, awayCupsRemaining: 10 }),
    ).toMatchObject({ winnerTeamId: "a" });
  });

  it("rejects cups outside 0..10 or non-integers", () => {
    expect(reasonOf(() => validateResult({ ...base, homeCupsRemaining: 11 }))).toBe("CUPS_OUT_OF_RANGE");
    expect(reasonOf(() => validateResult({ ...base, awayCupsRemaining: -1 }))).toBe("CUPS_OUT_OF_RANGE");
    expect(reasonOf(() => validateResult({ ...base, homeCupsRemaining: 2.5 }))).toBe("CUPS_OUT_OF_RANGE");
    expect(reasonOf(() => validateResult({ ...base, homeCupsRemaining: Number.NaN }))).toBe(
      "CUPS_OUT_OF_RANGE",
    );
  });

  it("rejects identical teams and foreign winners", () => {
    expect(reasonOf(() => validateResult({ ...base, awayTeamId: "h" }))).toBe("SAME_TEAMS");
    expect(reasonOf(() => validateResult({ ...base, winnerTeamId: "x" }))).toBe("WINNER_NOT_IN_MATCH");
  });

  it("REGULAR: loser 0, winner >= 1", () => {
    expect(reasonOf(() => validateResult({ ...base, awayCupsRemaining: 1 }))).toBe("REGULAR_LOSER_HAS_CUPS");
    expect(reasonOf(() => validateResult({ ...base, homeCupsRemaining: 0 }))).toBe("REGULAR_WINNER_NO_CUPS");
  });

  it("TIME_LIMIT: both >= 1 and winner ahead", () => {
    const tl = { ...base, endType: "TIME_LIMIT" as const };
    expect(validateResult({ ...tl, homeCupsRemaining: 4, awayCupsRemaining: 2 }).endType).toBe("TIME_LIMIT");
    expect(reasonOf(() => validateResult({ ...tl, homeCupsRemaining: 4, awayCupsRemaining: 0 }))).toBe(
      "TIME_LIMIT_ZERO_CUPS",
    );
    expect(reasonOf(() => validateResult({ ...tl, homeCupsRemaining: 2, awayCupsRemaining: 2 }))).toBe(
      "TIME_LIMIT_WINNER_NOT_AHEAD",
    );
    expect(reasonOf(() => validateResult({ ...tl, homeCupsRemaining: 1, awayCupsRemaining: 3 }))).toBe(
      "TIME_LIMIT_WINNER_NOT_AHEAD",
    );
  });

  it("SHOOTOUT: equal remaining cups >= 1", () => {
    const so = { ...base, endType: "SHOOTOUT" as const, winnerTeamId: "a" };
    expect(validateResult({ ...so, homeCupsRemaining: 2, awayCupsRemaining: 2 })).toMatchObject({
      winnerTeamId: "a",
      endType: "SHOOTOUT",
    });
    expect(reasonOf(() => validateResult({ ...so, homeCupsRemaining: 3, awayCupsRemaining: 2 }))).toBe(
      "SHOOTOUT_NOT_TIED",
    );
    expect(reasonOf(() => validateResult({ ...so, homeCupsRemaining: 0, awayCupsRemaining: 0 }))).toBe(
      "SHOOTOUT_NOT_TIED",
    );
  });

  it("FORFEIT only when allowed, normalized to 10:0", () => {
    const ff = { ...base, endType: "FORFEIT" as const, winnerTeamId: "a" };
    expect(reasonOf(() => validateResult(ff))).toBe("FORFEIT_NOT_ALLOWED");
    expect(validateResult(ff, { allowForfeit: true })).toEqual({
      winnerTeamId: "a",
      homeCupsRemaining: 0,
      awayCupsRemaining: 10,
      endType: "FORFEIT",
    });
  });

  it("rejects an unknown end type", () => {
    expect(
      reasonOf(() => validateResult({ ...base, endType: "DRAW" as unknown as ResultInput["endType"] })),
    ).toBe("UNKNOWN_END_TYPE");
  });

  it("messages are German without sharp s", () => {
    try {
      validateResult({ ...base, awayCupsRemaining: 2 });
    } catch (e) {
      expect((e as Error).message).not.toMatch(/ß/);
      expect((e as Error).message.length).toBeGreaterThan(10);
    }
  });

  it("property: accepted results always have a winner with more remaining cups or a tied shootout", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1, max: 11 }),
        fc.integer({ min: -1, max: 11 }),
        fc.boolean(),
        fc.constantFrom("REGULAR", "TIME_LIMIT", "SHOOTOUT") as fc.Arbitrary<ResultInput["endType"]>,
        (hc, ac, homeWins, endType) => {
          let r;
          try {
            r = validateResult({
              ...base,
              winnerTeamId: homeWins ? "h" : "a",
              homeCupsRemaining: hc,
              awayCupsRemaining: ac,
              endType,
            });
          } catch (e) {
            expect((e as DomainError).code).toBe("INVALID_RESULT");
            return;
          }
          const w = homeWins ? r.homeCupsRemaining : r.awayCupsRemaining;
          const l = homeWins ? r.awayCupsRemaining : r.homeCupsRemaining;
          if (endType === "SHOOTOUT") expect(w).toBe(l);
          else expect(w).toBeGreaterThan(l);
        },
      ),
    );
  });
});

describe("forfeitResult", () => {
  it("gives the winner 10 remaining and the loser 0", () => {
    expect(forfeitResult("h", "a", "h")).toEqual({
      winnerTeamId: "h",
      homeCupsRemaining: 10,
      awayCupsRemaining: 0,
      endType: "FORFEIT",
    });
  });
  it("rejects a foreign winner", () => {
    expect(() => forfeitResult("h", "a", "x")).toThrow(DomainError);
  });
});

describe("cupStats", () => {
  it("cupsFor = 10 - opponent remaining, cupsAgainst = 10 - own remaining", () => {
    const r = validateResult(base); // 3 : 0
    expect(cupStats(r, "HOME")).toEqual({ cupsFor: 10, cupsAgainst: 7 });
    expect(cupStats(r, "AWAY")).toEqual({ cupsFor: 7, cupsAgainst: 10 });
  });
  it("SHOOTOUT uses regulation cups only", () => {
    const r = validateResult({ ...base, endType: "SHOOTOUT", homeCupsRemaining: 4, awayCupsRemaining: 4 });
    expect(cupStats(r, "HOME")).toEqual({ cupsFor: 6, cupsAgainst: 6 });
    expect(cupStats(r, "AWAY")).toEqual({ cupsFor: 6, cupsAgainst: 6 });
  });
  it("FORFEIT counts 10:0", () => {
    const r = forfeitResult("h", "a", "a");
    expect(cupStats(r, "AWAY")).toEqual({ cupsFor: 10, cupsAgainst: 0 });
    expect(cupStats(r, "HOME")).toEqual({ cupsFor: 0, cupsAgainst: 10 });
  });
});
