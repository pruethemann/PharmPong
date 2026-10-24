import { describe, expect, it } from "vitest";
import {
  diffKnockoutSlots,
  downstreamCodes,
  expectedKnockoutSlots,
  KNOCKOUT_CODES,
  resolveQuarterfinals,
} from "./bracket";
import { buildKnockoutTemplates } from "./draw";
import type { MatchStatus, MatchView, Qualifiers } from "./types";

const Q: Qualifiers = { A1: "a1", A2: "a2", B1: "b1", B2: "b2", C1: "c1", C2: "c2", D1: "d1", D2: "d2" };

function koMatches(): MatchView[] {
  return buildKnockoutTemplates().map((t) => ({
    id: t.code,
    code: t.code,
    stage: t.stage,
    round: t.round,
    orderIndex: t.orderIndex,
    group: null,
    status: "PENDING",
    homeTeamId: null,
    awayTeamId: null,
    homeSource: t.homeSource,
    awaySource: t.awaySource,
    nextCode: t.nextCode,
    nextSlot: t.nextSlot,
    tableId: null,
    endedAt: null,
    result: null,
  }));
}

function decide(ms: MatchView[], code: string, winner: string, status: MatchStatus = "COMPLETED") {
  const i = ms.findIndex((m) => m.code === code);
  ms[i] = {
    ...ms[i],
    status,
    result: { winnerTeamId: winner, homeCupsRemaining: 2, awayCupsRemaining: 0, endType: "REGULAR" },
  };
}

function seat(ms: MatchView[], slots: ReturnType<typeof expectedKnockoutSlots>) {
  return ms.map((m) => {
    const s = slots[m.code as keyof typeof slots];
    return s ? { ...m, homeTeamId: s.home, awayTeamId: s.away } : m;
  });
}

describe("resolveQuarterfinals", () => {
  it("pairs A1-B2, B1-A2, C1-D2, D1-C2", () => {
    expect(resolveQuarterfinals(Q)).toEqual({
      QF1: { home: "a1", away: "b2" },
      QF2: { home: "b1", away: "a2" },
      QF3: { home: "c1", away: "d2" },
      QF4: { home: "d1", away: "c2" },
    });
  });
});

describe("downstreamCodes", () => {
  it("follows the bracket", () => {
    expect(KNOCKOUT_CODES).toEqual(["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"]);
    expect(downstreamCodes("QF1")).toEqual(["SF1", "F"]);
    expect(downstreamCodes("QF4")).toEqual(["SF2", "F"]);
    expect(downstreamCodes("SF2")).toEqual(["F"]);
    expect(downstreamCodes("F")).toEqual([]);
  });
  it("maps group codes to the quarterfinals seeded from that group", () => {
    expect(downstreamCodes("A-2")).toEqual(["QF1", "QF2", "SF1", "SF2", "F"]);
    expect(downstreamCodes("C-1")).toEqual(["QF3", "QF4", "SF1", "SF2", "F"]);
    expect(downstreamCodes("D-3")).toEqual(["QF3", "QF4", "SF1", "SF2", "F"]);
  });
  it("returns nothing for unknown codes", () => {
    expect(downstreamCodes("X")).toEqual([]);
    expect(downstreamCodes("E-1")).toEqual([]);
  });
});

describe("expectedKnockoutSlots", () => {
  it("is all null without qualifiers and results", () => {
    const e = expectedKnockoutSlots(koMatches(), null);
    expect(Object.keys(e)).toEqual([...KNOCKOUT_CODES]);
    for (const c of KNOCKOUT_CODES) expect(e[c]).toEqual({ home: null, away: null });
  });

  it("seeds QFs from qualifiers and later rounds from decided winners only", () => {
    const ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    decide(ms, "QF1", "a1");
    decide(ms, "QF3", "d2", "FORFEITED");
    const pending = ms.findIndex((m) => m.code === "QF2");
    ms[pending] = { ...ms[pending], status: "AWAITING_CONFIRMATION" };
    const e = expectedKnockoutSlots(ms, Q);
    expect(e.QF1).toEqual({ home: "a1", away: "b2" });
    expect(e.QF4).toEqual({ home: "d1", away: "c2" });
    expect(e.SF1).toEqual({ home: "a1", away: "d2" });
    expect(e.SF2).toEqual({ home: null, away: null });
    expect(e.F).toEqual({ home: null, away: null });
  });

  it("propagates winners to the final", () => {
    let ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    for (const [c, w] of [
      ["QF1", "a1"],
      ["QF2", "a2"],
      ["QF3", "c1"],
      ["QF4", "c2"],
    ]) {
      decide(ms, c, w);
    }
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    decide(ms, "SF1", "c1");
    decide(ms, "SF2", "a2");
    expect(expectedKnockoutSlots(ms, Q).F).toEqual({ home: "c1", away: "a2" });
  });

  it("ignores winners of feeders played between the wrong teams", () => {
    // QF1 decided but never seated: its participants do not match {a1, b2}.
    const unseated = koMatches();
    decide(unseated, "QF1", "a1");
    expect(expectedKnockoutSlots(unseated, Q).SF1.home).toBeNull();
    // Seated correctly, but the recorded winner is not one of the two teams.
    const ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    decide(ms, "QF1", "zz");
    expect(expectedKnockoutSlots(ms, Q).SF1.home).toBeNull();
    // Without qualifiers no quarterfinal winner is trusted.
    const seated = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    decide(seated, "QF1", "a1");
    expect(expectedKnockoutSlots(seated, null).SF1).toEqual({ home: null, away: null });
  });
});

describe("diffKnockoutSlots", () => {
  it("is empty when the bracket matches", () => {
    let ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    decide(ms, "QF1", "a1");
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    expect(diffKnockoutSlots(ms, expectedKnockoutSlots(ms, Q))).toEqual([]);
  });

  it("reports the stale SF slot after a corrected QF result", () => {
    let ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    decide(ms, "QF1", "a1");
    decide(ms, "QF3", "c1");
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    expect(ms.find((m) => m.code === "SF1")).toMatchObject({ homeTeamId: "a1", awayTeamId: "c1" });
    const sf = ms.findIndex((m) => m.code === "SF1");
    ms[sf] = { ...ms[sf], status: "READY" };

    decide(ms, "QF1", "b2"); // correction: b2 actually won QF1
    expect(diffKnockoutSlots(ms, expectedKnockoutSlots(ms, Q))).toEqual([
      { code: "SF1", slot: "HOME", current: "a1", expected: "b2", status: "READY" },
    ]);
  });

  it("reports the whole downstream path when a qualifier changes after QF1 was decided", () => {
    let ms = seat(koMatches(), expectedKnockoutSlots(koMatches(), Q));
    for (const [c, w] of [
      ["QF1", "a1"],
      ["QF2", "b1"],
      ["QF3", "c1"],
      ["QF4", "d1"],
    ]) {
      decide(ms, c, w);
    }
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    decide(ms, "SF1", "a1");
    decide(ms, "SF2", "b1");
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    expect(diffKnockoutSlots(ms, expectedKnockoutSlots(ms, Q))).toEqual([]);

    // Group correction swaps A1 and A2.
    const swapped = { ...Q, A1: "a2", A2: "a1" };
    expect(diffKnockoutSlots(ms, expectedKnockoutSlots(ms, swapped))).toEqual([
      { code: "QF1", slot: "HOME", current: "a1", expected: "a2", status: "COMPLETED" },
      { code: "QF2", slot: "AWAY", current: "a2", expected: "a1", status: "COMPLETED" },
      { code: "SF1", slot: "HOME", current: "a1", expected: null, status: "COMPLETED" },
      { code: "SF2", slot: "HOME", current: "b1", expected: null, status: "COMPLETED" },
      { code: "F", slot: "HOME", current: "a1", expected: null, status: "PENDING" },
      { code: "F", slot: "AWAY", current: "b1", expected: null, status: "PENDING" },
    ]);
  });

  it("reports QF slots when qualifiers change and both sides when cleared", () => {
    let ms = koMatches();
    ms = seat(ms, expectedKnockoutSlots(ms, Q));
    const changed = { ...Q, A2: "a3" };
    expect(diffKnockoutSlots(ms, expectedKnockoutSlots(ms, changed))).toEqual([
      { code: "QF2", slot: "AWAY", current: "a2", expected: "a3", status: "PENDING" },
    ]);
    const cleared = diffKnockoutSlots(ms, expectedKnockoutSlots(ms, null));
    expect(cleared).toHaveLength(8);
    expect(cleared[0]).toEqual({
      code: "QF1",
      slot: "HOME",
      current: "a1",
      expected: null,
      status: "PENDING",
    });
  });

  it("ignores group matches and codes without expectations", () => {
    const ms = koMatches();
    const group: MatchView = { ...ms[0], id: "g", code: "A-1", stage: "GROUP", homeTeamId: "x" };
    expect(diffKnockoutSlots([group], { QF1: { home: null, away: null } })).toEqual([]);
    expect(diffKnockoutSlots(ms, {})).toEqual([]);
  });
});
