import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forfeitResult } from "./result-rules";
import { computeGroupStandings, computeQualifiers, tieBasisHash } from "./standings";
import type { EndType, GroupName, GroupStandings, MatchStatus, MatchView, TiebreakRecord } from "./types";

type Played = {
  winner: "home" | "away";
  home: number;
  away: number;
  endType?: EndType;
  status?: MatchStatus;
};

function groupMatches(group: GroupName, [p1, p2, p3]: string[], results: Array<Played | null>): MatchView[] {
  const pairs: Array<[string, string]> = [
    [p1, p2],
    [p3, p1],
    [p2, p3],
  ];
  return pairs.map(([home, away], i) => {
    const r = results[i];
    return {
      id: `${group}-${i + 1}`,
      code: `${group}-${i + 1}`,
      stage: "GROUP",
      round: i + 1,
      orderIndex: i * 4 + 1,
      group,
      status: r ? (r.status ?? "COMPLETED") : "READY",
      homeTeamId: home,
      awayTeamId: away,
      homeSource: null,
      awaySource: null,
      nextCode: null,
      nextSlot: null,
      tableId: null,
      endedAt: r ? i * 1000 : null,
      result: r
        ? {
            winnerTeamId: r.winner === "home" ? home : away,
            homeCupsRemaining: r.home,
            awayCupsRemaining: r.away,
            endType: r.endType ?? "REGULAR",
          }
        : null,
    };
  });
}

const T = ["a", "b", "c"];
const order = (s: GroupStandings) => s.rows.map((r) => r.teamId);
const ranks = (s: GroupStandings) => s.rows.map((r) => r.rank);
const by = (s: GroupStandings) => s.rows.map((r) => r.decidedBy);

// A-1 a v b, A-2 c v a, A-3 b v c
describe("computeGroupStandings scenarios", () => {
  it("clean 6-3-0", () => {
    const m = groupMatches("A", T, [
      { winner: "home", home: 4, away: 0 }, // a beats b
      { winner: "away", home: 0, away: 2 }, // a beats c
      { winner: "home", home: 1, away: 0 }, // b beats c
    ]);
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["a", "b", "c"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(by(s)).toEqual(["POINTS", "POINTS", "POINTS"]);
    expect(s.rows.map((r) => r.points)).toEqual([6, 3, 0]);
    expect(s.rows[0]).toMatchObject({
      played: 2,
      wins: 2,
      losses: 0,
      cupsFor: 20,
      cupsAgainst: 14,
      cupDiff: 6,
    });
    expect(s.complete).toBe(true);
    expect(s.unresolved).toEqual([]);
    expect(s.rows.every((r) => !r.provisional)).toBe(true);
  });

  it("3-3-3 cycle separated by cup difference", () => {
    const m = groupMatches("A", T, [
      { winner: "home", home: 6, away: 0 }, // a beats b, a +6
      { winner: "home", home: 1, away: 0 }, // c beats a, c +1
      { winner: "home", home: 3, away: 0 }, // b beats c, b +3
    ]);
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["a", "c", "b"]);
    expect(s.rows.map((r) => r.cupDiff)).toEqual([5, -2, -3]);
    expect(by(s)).toEqual(["CUP_DIFF", "CUP_DIFF", "CUP_DIFF"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(s.complete).toBe(true);
  });

  it("cycle with equal cup difference separated by cups for", () => {
    const m = groupMatches("A", T, [
      { winner: "home", home: 3, away: 0 }, // a beats b
      { winner: "home", home: 2, away: 0 }, // c beats a
      { winner: "home", home: 3, away: 2, endType: "TIME_LIMIT" }, // b beats c
    ]);
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["a", "c", "b"]);
    expect(s.rows.map((r) => [r.cupDiff, r.cupsFor])).toEqual([
      [1, 18],
      [1, 17],
      [-2, 15],
    ]);
    expect(by(s)).toEqual(["CUPS_FOR", "CUPS_FOR", "CUP_DIFF"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(s.complete).toBe(true);
  });

  it("two teams equal on diff and cups for are separated head-to-head", () => {
    const m = groupMatches("A", T, [
      { winner: "home", home: 2, away: 1, endType: "TIME_LIMIT" }, // a beats b
      { winner: "home", home: 2, away: 0 }, // c beats a
      { winner: "home", home: 3, away: 0 }, // b beats c
    ]);
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["b", "c", "a"]);
    expect(by(s)).toEqual(["CUP_DIFF", "HEAD_TO_HEAD", "HEAD_TO_HEAD"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(s.rows[1]).toMatchObject({ cupDiff: -1, cupsFor: 17 });
    expect(s.rows[2]).toMatchObject({ cupDiff: -1, cupsFor: 17 });
    expect(s.complete).toBe(true);
  });

  const fullTie = groupMatches("A", T, [
    { winner: "home", home: 5, away: 0 },
    { winner: "home", home: 5, away: 0 },
    { winner: "home", home: 5, away: 0 },
  ]);

  it("full three-way tie stays unresolved with positions [1,2,3]", () => {
    const s = computeGroupStandings("A", T, fullTie, []);
    expect(order(s)).toEqual(["a", "b", "c"]); // draw order
    expect(ranks(s)).toEqual([null, null, null]);
    expect(by(s)).toEqual([null, null, null]);
    expect(s.complete).toBe(false);
    expect(s.unresolved).toEqual([
      { group: "A", teamIds: ["a", "b", "c"], basisHash: tieBasisHash(T, s.rows), positions: [1, 2, 3] },
    ]);
    expect(s.unresolved[0].basisHash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeQualifiers([s])).toBeNull();
  });

  it("full three-way tie resolved by a matching shootout record", () => {
    const open = computeGroupStandings("A", T, fullTie, []);
    const tb: TiebreakRecord = {
      teamIds: ["a", "b", "c"],
      orderedTeamIds: ["c", "a", "b"],
      basisHash: open.unresolved[0].basisHash,
    };
    const s = computeGroupStandings("A", T, fullTie, [tb]);
    expect(order(s)).toEqual(["c", "a", "b"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(by(s)).toEqual(["SHOOTOUT", "SHOOTOUT", "SHOOTOUT"]);
    expect(s.complete).toBe(true);
    expect(s.unresolved).toEqual([]);
  });

  it("ignores a tiebreak with a stale basis hash or a different team set", () => {
    const stale: TiebreakRecord = {
      teamIds: ["a", "b", "c"],
      orderedTeamIds: ["c", "a", "b"],
      basisHash: "0".repeat(64),
    };
    expect(computeGroupStandings("A", T, fullTie, [stale]).complete).toBe(false);
    const hash = computeGroupStandings("A", T, fullTie, []).unresolved[0].basisHash;
    const wrongSet: TiebreakRecord = {
      teamIds: ["a", "b", "x"],
      orderedTeamIds: ["x", "a", "b"],
      basisHash: hash,
    };
    expect(computeGroupStandings("A", T, fullTie, [wrongSet]).complete).toBe(false);
  });

  it("a corrected result changes the basis hash and invalidates the shootout", () => {
    const hash = computeGroupStandings("A", T, fullTie, []).unresolved[0].basisHash;
    const corrected = groupMatches("A", T, [
      { winner: "home", home: 4, away: 0 },
      { winner: "home", home: 4, away: 0 },
      { winner: "home", home: 4, away: 0 },
    ]);
    const s = computeGroupStandings("A", T, corrected, [
      { teamIds: ["a", "b", "c"], orderedTeamIds: ["c", "a", "b"], basisHash: hash },
    ]);
    expect(s.complete).toBe(false);
    expect(s.unresolved[0].basisHash).not.toBe(hash);
  });

  it("SHOOTOUT match stats use regulation cups only", () => {
    const m = groupMatches("A", T, [{ winner: "away", home: 3, away: 3, endType: "SHOOTOUT" }, null, null]);
    const s = computeGroupStandings("A", T, m, []);
    const b = s.rows.find((r) => r.teamId === "b")!;
    const a = s.rows.find((r) => r.teamId === "a")!;
    expect(b).toMatchObject({ points: 3, cupsFor: 7, cupsAgainst: 7, cupDiff: 0, wins: 1 });
    expect(a).toMatchObject({ points: 0, cupsFor: 7, cupsAgainst: 7, cupDiff: 0, losses: 1 });
  });

  it("FORFEIT counts 10:0", () => {
    const m = groupMatches("A", T, [null, null, null]);
    m[0] = { ...m[0], status: "FORFEITED", result: forfeitResult("a", "b", "b") };
    const s = computeGroupStandings("A", T, m, []);
    expect(s.rows[0]).toMatchObject({ teamId: "b", points: 3, cupsFor: 10, cupsAgainst: 0, cupDiff: 10 });
    expect(s.rows.find((r) => r.teamId === "a")).toMatchObject({ cupsFor: 0, cupsAgainst: 10 });
  });

  it("incomplete group: provisional ranks where determinable, no qualifiers", () => {
    const m = groupMatches("A", T, [{ winner: "home", home: 4, away: 0 }, null, null]);
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["a", "c", "b"]);
    expect(ranks(s)).toEqual([1, 2, 3]);
    expect(s.rows.every((r) => r.provisional)).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.unresolved).toEqual([]);
  });

  it("incomplete group with an undecided mutual match: ranks null, no unresolved tie", () => {
    const s0 = computeGroupStandings("A", T, groupMatches("A", T, [null, null, null]), []);
    expect(ranks(s0)).toEqual([null, null, null]);
    expect(s0.unresolved).toEqual([]);
    // a beat b and c (both 5:0), b v c still open: b and c tied, mutual match undecided
    const tied = groupMatches("A", T, [
      { winner: "home", home: 5, away: 0 },
      { winner: "away", home: 0, away: 5 },
      null,
    ]);
    const st = computeGroupStandings("A", T, tied, []);
    expect(order(st)).toEqual(["a", "b", "c"]);
    expect(ranks(st)).toEqual([1, null, null]);
    expect(by(st)).toEqual(["POINTS", null, null]);
    expect(st.unresolved).toEqual([]);
    // only b v c played: a (no stats) is separated from c by cup difference
    const m = groupMatches("A", T, [null, null, { winner: "home", home: 10, away: 0 }]);
    const s = computeGroupStandings("A", T, m, []);
    expect(s.rows[0]).toMatchObject({ teamId: "b", rank: 1 });
    expect(s.rows[1]).toMatchObject({ teamId: "a", rank: 2, decidedBy: "CUP_DIFF" });
  });

  it("two-way tie without a decided mutual match after all matches decided (forfeit without result)", () => {
    // A-1 a v b forfeited but result missing: a and b cannot be separated head-to-head
    const m = groupMatches("A", T, [
      { winner: "home", home: 5, away: 0, status: "FORFEITED" },
      { winner: "away", home: 0, away: 5 }, // a beats c
      { winner: "home", home: 5, away: 0 }, // b beats c
    ]);
    m[0] = { ...m[0], result: null };
    const s = computeGroupStandings("A", T, m, []);
    expect(order(s)).toEqual(["a", "b", "c"]);
    expect(ranks(s)).toEqual([null, null, 3]);
    expect(s.unresolved).toHaveLength(1);
    expect(s.unresolved[0]).toMatchObject({ teamIds: ["a", "b"], positions: [1, 2] });
    expect(s.complete).toBe(false);
    const resolved = computeGroupStandings("A", T, m, [
      { teamIds: ["a", "b"], orderedTeamIds: ["b", "a"], basisHash: s.unresolved[0].basisHash },
    ]);
    expect(order(resolved)).toEqual(["b", "a", "c"]);
    expect(by(resolved)).toEqual(["SHOOTOUT", "SHOOTOUT", "POINTS"]);
    expect(resolved.complete).toBe(true);
  });

  it("ignores matches of foreign teams and undecided results", () => {
    const m = groupMatches("A", T, [
      { winner: "home", home: 5, away: 0, status: "AWAITING_CONFIRMATION" },
      null,
      null,
    ]);
    const s = computeGroupStandings("A", T, m, []);
    expect(s.rows.every((r) => r.played === 0)).toBe(true);
    const foreign = groupMatches("A", ["a", "x", "y"], [{ winner: "home", home: 5, away: 0 }, null, null]);
    const s2 = computeGroupStandings("A", T, foreign, []);
    expect(s2.rows.find((r) => r.teamId === "a")!.points).toBe(3);
    expect(s2.rows).toHaveLength(3);
  });
});

describe("tieBasisHash", () => {
  it("is independent of team order and sensitive to stats", () => {
    const s = computeGroupStandings("A", T, groupMatches("A", T, [null, null, null]), []);
    expect(tieBasisHash(["c", "a", "b"], s.rows)).toBe(tieBasisHash(["a", "b", "c"], s.rows));
    const changed = s.rows.map((r) => (r.teamId === "a" ? { ...r, cupsFor: 1 } : r));
    expect(tieBasisHash(T, changed)).not.toBe(tieBasisHash(T, s.rows));
    expect(tieBasisHash(["zz"], [])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeQualifiers", () => {
  const clean = (g: GroupName) => {
    const ids = [`${g}1`, `${g}2`, `${g}3`];
    return computeGroupStandings(
      g,
      ids,
      groupMatches(g, ids, [
        { winner: "home", home: 4, away: 0 },
        { winner: "away", home: 0, away: 2 },
        { winner: "home", home: 1, away: 0 },
      ]),
      [],
    );
  };
  it("maps winners and runners-up once every group is complete", () => {
    const all = (["D", "C", "B", "A"] as GroupName[]).map(clean);
    expect(computeQualifiers(all)).toEqual({
      A1: "A1",
      A2: "A2",
      B1: "B1",
      B2: "B2",
      C1: "C1",
      C2: "C2",
      D1: "D1",
      D2: "D2",
    });
  });
  it("returns null when a group is missing or incomplete", () => {
    expect(computeQualifiers((["A", "B", "C"] as GroupName[]).map(clean))).toBeNull();
    const ids = ["D1", "D2", "D3"];
    const incomplete = computeGroupStandings("D", ids, groupMatches("D", ids, [null, null, null]), []);
    expect(computeQualifiers([...(["A", "B", "C"] as GroupName[]).map(clean), incomplete])).toBeNull();
  });
  it("returns null for a malformed complete group without ranks", () => {
    const all = (["A", "B", "C", "D"] as GroupName[]).map(clean);
    all[3] = { ...all[3], rows: all[3].rows.map((r) => ({ ...r, rank: null })) };
    expect(computeQualifiers(all)).toBeNull();
  });
});

describe("standings properties", () => {
  const resultArb: fc.Arbitrary<Played | null> = fc.option(
    fc
      .record({
        winner: fc.constantFrom("home", "away") as fc.Arbitrary<"home" | "away">,
        kind: fc.constantFrom("REGULAR", "TIME_LIMIT", "SHOOTOUT", "FORFEIT") as fc.Arbitrary<EndType>,
        w: fc.integer({ min: 1, max: 10 }),
        l: fc.integer({ min: 1, max: 10 }),
      })
      .map(({ winner, kind, w, l }) => {
        let wl = w;
        let ll = l;
        if (kind === "REGULAR") ll = 0;
        if (kind === "TIME_LIMIT")
          [wl, ll] = w === l ? [Math.min(10, w + 1), Math.max(1, l - 1)] : [Math.max(w, l), Math.min(w, l)];
        if (kind === "TIME_LIMIT" && wl === ll) wl = Math.min(10, wl + 1);
        if (kind === "SHOOTOUT") ll = wl;
        if (kind === "FORFEIT") [wl, ll] = [10, 0];
        return {
          winner,
          endType: kind,
          status: (kind === "FORFEIT" ? "FORFEITED" : "COMPLETED") as MatchStatus,
          home: winner === "home" ? wl : ll,
          away: winner === "home" ? ll : wl,
        };
      }),
    { nil: null },
  );
  const groupArb = fc.tuple(resultArb, resultArb, resultArb);

  it("total points = 3 x decided matches, sum of cup diff = 0", () => {
    fc.assert(
      fc.property(groupArb, (results) => {
        const s = computeGroupStandings("B", T, groupMatches("B", T, results), []);
        const decided = results.filter((r) => r !== null).length;
        expect(s.rows.reduce((n, r) => n + r.points, 0)).toBe(3 * decided);
        expect(s.rows.reduce((n, r) => n + r.cupDiff, 0)).toBe(0);
        expect(s.rows.reduce((n, r) => n + r.played, 0)).toBe(2 * decided);
        if (decided === 3) expect(s.rows.every((r) => !r.provisional)).toBe(true);
        if (s.complete) expect(ranks(s)).toEqual([1, 2, 3]);
        // ranks, when present, follow sort order
        const rk = ranks(s).filter((r): r is number => r !== null);
        expect([...rk].sort((x, y) => x - y)).toEqual(rk);
      }),
    );
  });

  it("is deterministic regardless of input match order", () => {
    fc.assert(
      fc.property(groupArb, fc.constantFrom([0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]), (results, perm) => {
        const m = groupMatches("C", T, results);
        const a = computeGroupStandings("C", T, m, []);
        const b = computeGroupStandings(
          "C",
          T,
          perm.map((i) => m[i]),
          [],
        );
        expect(b).toEqual(a);
      }),
    );
  });
});
