import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildKnockoutTemplates, drawGroups, secureRng, type Rng } from "./draw";
import { DomainError } from "./errors";
import { GROUP_NAMES } from "./types";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
const identityRng: Rng = (max) => max - 1; // Fisher–Yates with j = i keeps the order

/** rng arbitrary: a seed stream mapped into range. */
const rngArb = fc.array(fc.nat(), { minLength: 11, maxLength: 11 }).map((xs) => {
  let i = 0;
  return ((max: number) => xs[i++ % xs.length] % max) as Rng;
});

describe("drawGroups", () => {
  it("rejects anything but 12 distinct teams", () => {
    expect(() => drawGroups(TEAMS.slice(0, 11), identityRng)).toThrow(DomainError);
    expect(() => drawGroups([...TEAMS, "x"], identityRng)).toThrow(DomainError);
    const dup = [...TEAMS.slice(0, 11), TEAMS[0]];
    try {
      drawGroups(dup, identityRng);
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe("WRONG_TEAM_COUNT");
    }
  });

  it("rejects an rng that returns out-of-range values", () => {
    expect(() => drawGroups(TEAMS, () => 99)).toThrow(RangeError);
  });

  it("chunks the shuffled list into A,B,C,D in draw order", () => {
    const { groups } = drawGroups(TEAMS, identityRng);
    expect(groups).toEqual({
      A: ["t01", "t02", "t03"],
      B: ["t04", "t05", "t06"],
      C: ["t07", "t08", "t09"],
      D: ["t10", "t11", "t12"],
    });
  });

  it("builds group fixtures p1-p2, p3-p1, p2-p3 interleaved across groups", () => {
    const { fixtures } = drawGroups(TEAMS, identityRng);
    const byCode = Object.fromEntries(fixtures.map((f) => [f.code, f]));
    expect(byCode["A-1"]).toMatchObject({ homeTeamId: "t01", awayTeamId: "t02", round: 1, orderIndex: 1 });
    expect(byCode["A-2"]).toMatchObject({ homeTeamId: "t03", awayTeamId: "t01", round: 2, orderIndex: 5 });
    expect(byCode["A-3"]).toMatchObject({ homeTeamId: "t02", awayTeamId: "t03", round: 3, orderIndex: 9 });
    expect(byCode["D-1"]).toMatchObject({ homeTeamId: "t10", awayTeamId: "t11", orderIndex: 4, group: "D" });
    expect(byCode["B-2"].orderIndex).toBe(6);
    expect(byCode["D-3"].orderIndex).toBe(12);
    for (const f of fixtures.filter((x) => x.stage === "GROUP")) {
      expect(f).toMatchObject({ homeSource: null, awaySource: null, nextCode: null, nextSlot: null });
    }
  });

  it("secureRng stays in range and works with drawGroups", () => {
    for (let i = 0; i < 50; i++) {
      const v = secureRng(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
    expect(drawGroups(TEAMS, secureRng).fixtures).toHaveLength(19);
  });

  it("property: always a 4x3 permutation with 19 well-formed fixtures", () => {
    fc.assert(
      fc.property(rngArb, (rng) => {
        const { groups, fixtures } = drawGroups(TEAMS, rng);
        const flat = GROUP_NAMES.flatMap((g) => groups[g]);
        expect(GROUP_NAMES.every((g) => groups[g].length === 3)).toBe(true);
        expect([...flat].sort()).toEqual(TEAMS);

        expect(fixtures).toHaveLength(19);
        expect(fixtures.filter((f) => f.stage === "GROUP")).toHaveLength(12);
        expect(fixtures.filter((f) => f.stage === "KNOCKOUT")).toHaveLength(7);
        expect(fixtures.map((f) => f.orderIndex).sort((a, b) => a - b)).toEqual(
          Array.from({ length: 19 }, (_, i) => i + 1),
        );
        expect(new Set(fixtures.map((f) => f.code)).size).toBe(19);

        // every pair in a group plays exactly once
        for (const g of GROUP_NAMES) {
          const pairs = fixtures
            .filter((f) => f.group === g)
            .map((f) => [f.homeTeamId!, f.awayTeamId!].sort().join("|"))
            .sort();
          const [a, b, c] = groups[g];
          expect(pairs).toEqual(
            [
              [a, b],
              [a, c],
              [b, c],
            ]
              .map((p) => p.sort().join("|"))
              .sort(),
          );
        }

        // consecutive group pairs (1,2),(3,4).. never share a team
        const byOrder = new Map(fixtures.map((f) => [f.orderIndex, f]));
        for (let o = 1; o <= 11; o += 2) {
          const x = byOrder.get(o)!;
          const y = byOrder.get(o + 1)!;
          const teams = new Set([x.homeTeamId, x.awayTeamId, y.homeTeamId, y.awayTeamId]);
          expect(teams.size).toBe(4);
        }

        // each team hosts exactly one group match
        for (const g of GROUP_NAMES) {
          const homes = fixtures.filter((f) => f.group === g).map((f) => f.homeTeamId);
          expect(new Set(homes).size).toBe(3);
        }
      }),
    );
  });
});

describe("buildKnockoutTemplates", () => {
  it("pairs and links the bracket as specified", () => {
    const ko = buildKnockoutTemplates();
    const view = ko.map((f) => [
      f.code,
      f.round,
      f.orderIndex,
      f.homeSource,
      f.awaySource,
      f.nextCode,
      f.nextSlot,
    ]);
    expect(view).toEqual([
      ["QF1", 1, 13, "A1", "B2", "SF1", "HOME"],
      ["QF2", 1, 14, "B1", "A2", "SF2", "HOME"],
      ["QF3", 1, 15, "C1", "D2", "SF1", "AWAY"],
      ["QF4", 1, 16, "D1", "C2", "SF2", "AWAY"],
      ["SF1", 2, 17, "W:QF1", "W:QF3", "F", "HOME"],
      ["SF2", 2, 18, "W:QF2", "W:QF4", "F", "AWAY"],
      ["F", 3, 19, "W:SF1", "W:SF2", null, null],
    ]);
    for (const f of ko) {
      expect(f).toMatchObject({ stage: "KNOCKOUT", group: null, homeTeamId: null, awayTeamId: null });
    }
  });
});
