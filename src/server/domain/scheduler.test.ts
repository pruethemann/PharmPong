import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { drawGroups, type Rng } from "./draw";
import { eligibility, suggestAssignments } from "./scheduler";
import type { MatchStatus, MatchView, TableView } from "./types";

function mv(p: Partial<MatchView> & { id: string }): MatchView {
  return {
    code: p.id,
    stage: "GROUP",
    round: 1,
    orderIndex: 1,
    group: "A",
    status: "READY",
    homeTeamId: null,
    awayTeamId: null,
    homeSource: null,
    awaySource: null,
    nextCode: null,
    nextSlot: null,
    tableId: null,
    endedAt: null,
    result: null,
    ...p,
  };
}

const T1: TableView = { id: "t1", number: 1, isDisabled: false };
const T2: TableView = { id: "t2", number: 2, isDisabled: false };

describe("suggestAssignments", () => {
  it("assigns earliest ready matches to tables by number", () => {
    const ms = [
      mv({ id: "m2", orderIndex: 2, homeTeamId: "c", awayTeamId: "d" }),
      mv({ id: "m1", orderIndex: 1, homeTeamId: "a", awayTeamId: "b" }),
      mv({ id: "m3", orderIndex: 3, homeTeamId: "e", awayTeamId: "f" }),
    ];
    expect(suggestAssignments(ms, [T2, T1])).toEqual([
      { tableId: "t1", matchId: "m1" },
      { tableId: "t2", matchId: "m2" },
    ]);
  });

  it("excludes busy teams and occupied or disabled tables", () => {
    const ms = [
      mv({ id: "live", status: "IN_PROGRESS", tableId: "t1", homeTeamId: "a", awayTeamId: "x" }),
      mv({ id: "m1", orderIndex: 1, homeTeamId: "a", awayTeamId: "b" }),
      mv({ id: "m2", orderIndex: 2, homeTeamId: "c", awayTeamId: "d" }),
    ];
    expect(suggestAssignments(ms, [T1, T2])).toEqual([{ tableId: "t2", matchId: "m2" }]);
    expect(suggestAssignments(ms, [T1, { ...T2, isDisabled: true }])).toEqual([]);
    expect(suggestAssignments(ms, [])).toEqual([]);
  });

  it("skips non-ready matches and matches with missing teams", () => {
    const ms = [
      mv({ id: "p", status: "PENDING", homeTeamId: "a", awayTeamId: "b" }),
      mv({ id: "k", stage: "KNOCKOUT", homeTeamId: "c", awayTeamId: null }),
      mv({ id: "done", status: "COMPLETED", homeTeamId: "e", awayTeamId: "f" }),
    ];
    expect(suggestAssignments(ms, [T1, T2])).toEqual([]);
  });

  it("prefers the group stage, then earlier rounds", () => {
    const ms = [
      mv({ id: "ko", stage: "KNOCKOUT", round: 1, orderIndex: 13, homeTeamId: "a", awayTeamId: "b" }),
      mv({ id: "r2", round: 2, orderIndex: 5, homeTeamId: "c", awayTeamId: "d" }),
      mv({ id: "r1", round: 1, orderIndex: 9, homeTeamId: "e", awayTeamId: "f" }),
    ];
    expect(suggestAssignments(ms, [T1, T2]).map((a) => a.matchId)).toEqual(["r1", "r2"]);
  });

  it("never suggests the same team twice in a batch", () => {
    const ms = [
      mv({ id: "m1", orderIndex: 1, homeTeamId: "a", awayTeamId: "b" }),
      mv({ id: "m2", orderIndex: 2, homeTeamId: "a", awayTeamId: "c" }),
      mv({ id: "m3", orderIndex: 3, homeTeamId: "d", awayTeamId: "e" }),
    ];
    expect(suggestAssignments(ms, [T1, T2])).toEqual([
      { tableId: "t1", matchId: "m1" },
      { tableId: "t2", matchId: "m3" },
    ]);
  });

  it("follows play order even when an earlier match has less-rested teams", () => {
    // Round 2 of a real draw: A-2 (orderIndex 5) and B-2 (orderIndex 6).
    // Team a played very recently, team c long ago: play order still wins.
    const ms = [
      mv({ id: "A-1", status: "COMPLETED", homeTeamId: "a", awayTeamId: "b", endedAt: 5000 }),
      mv({
        id: "B-1",
        status: "COMPLETED",
        orderIndex: 2,
        group: "B",
        homeTeamId: "c",
        awayTeamId: "d",
        endedAt: 1000,
      }),
      mv({ id: "B-2", round: 2, orderIndex: 6, group: "B", homeTeamId: "e", awayTeamId: "c" }),
      mv({ id: "A-2", round: 2, orderIndex: 5, homeTeamId: "f", awayTeamId: "a" }),
    ];
    expect(suggestAssignments(ms, [T1]).map((a) => a.matchId)).toEqual(["A-2"]);
    expect(suggestAssignments(ms, [T1, T2]).map((a) => a.matchId)).toEqual(["A-2", "B-2"]);
  });

  it("property: suggestions over a full draw never reuse tables or teams and skip busy teams", () => {
    const statuses: MatchStatus[] = ["PENDING", "READY", "ASSIGNED", "IN_PROGRESS", "COMPLETED"];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...statuses), { minLength: 12, maxLength: 12 }),
        fc.array(fc.nat(), { minLength: 11, maxLength: 11 }),
        fc.boolean(),
        (sts, seed, disable2) => {
          let i = 0;
          const rng: Rng = (max) => seed[i++ % seed.length] % max;
          const teams = Array.from({ length: 12 }, (_, k) => `t${k}`);
          const { fixtures } = drawGroups(teams, rng);
          let tableTurn = 0;
          const ms = fixtures
            .filter((f) => f.stage === "GROUP")
            .map((f, k) => {
              const status = sts[k];
              const active = status === "ASSIGNED" || status === "IN_PROGRESS";
              return mv({ ...f, id: f.code, status, tableId: active ? `t${(tableTurn++ % 2) + 1}` : null });
            });
          const tables = [T1, { ...T2, isDisabled: disable2 }];
          const out = suggestAssignments(ms, tables);
          const busy = new Set(
            ms
              .filter((m) => ["ASSIGNED", "IN_PROGRESS"].includes(m.status))
              .flatMap((m) => [m.homeTeamId, m.awayTeamId]),
          );
          const used = out.flatMap((a) => {
            const m = ms.find((x) => x.id === a.matchId)!;
            expect(m.status).toBe("READY");
            return [m.homeTeamId, m.awayTeamId];
          });
          expect(new Set(used).size).toBe(used.length);
          expect(used.some((t) => busy.has(t))).toBe(false);
          expect(new Set(out.map((a) => a.tableId)).size).toBe(out.length);
          if (disable2) expect(out.every((a) => a.tableId === "t1")).toBe(true);
        },
      ),
    );
  });
});

describe("eligibility", () => {
  const live = mv({ id: "live", status: "AWAITING_CONFIRMATION", homeTeamId: "a", awayTeamId: "x" });
  it("explains why a match cannot be assigned", () => {
    expect(eligibility([], mv({ id: "d", status: "COMPLETED", homeTeamId: "a", awayTeamId: "b" }))).toEqual({
      eligible: false,
      reason: "DECIDED",
    });
    expect(eligibility([], mv({ id: "k", homeTeamId: "a" }))).toEqual({
      eligible: false,
      reason: "MISSING_TEAMS",
    });
    expect(eligibility([], mv({ id: "p", status: "PENDING", homeTeamId: "a", awayTeamId: "b" }))).toEqual({
      eligible: false,
      reason: "NOT_READY",
    });
    const m = mv({ id: "m", homeTeamId: "b", awayTeamId: "a" });
    expect(eligibility([live, m], m)).toEqual({ eligible: false, reason: "TEAM_BUSY" });
  });
  it("accepts a ready match with free teams and ignores itself", () => {
    const m = mv({ id: "m", homeTeamId: "c", awayTeamId: "d" });
    expect(eligibility([live, m], m)).toEqual({ eligible: true });
    const assigned = mv({ id: "as", status: "ASSIGNED", homeTeamId: "c", awayTeamId: "d" });
    expect(eligibility([assigned], assigned)).toEqual({ eligible: false, reason: "NOT_READY" });
  });
});
