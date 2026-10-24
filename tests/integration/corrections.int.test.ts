import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { correctResult, executeRecovery, planRecovery } from "@/server/services/corrections";
import { assignMatch } from "@/server/services/matches";
import { loadTournamentState } from "@/server/services/state";
import type { Match } from "@/generated/prisma/client";
import {
  assertInvariants,
  assignAndStart,
  buildDrawnTournament,
  buildKnockoutTournament,
  errorCode,
  getMatch,
  getTournament,
  playMatch,
  seedGroupResults,
  type Fixture,
} from "./match-fixtures";

let current: Fixture | null = null;

afterEach(async () => {
  if (current) await assertInvariants(current.t.id);
  current = null;
});

/** Result where the AWAY team of `m` wins 0:2 (REGULAR). */
const awayWins = (m: Match) => ({
  winnerTeamId: m.awayTeamId!,
  homeCupsRemaining: 0,
  awayCupsRemaining: 2,
  endType: "REGULAR" as const,
});
const homeWins = (m: Match, cups = 2) => ({
  winnerTeamId: m.homeTeamId!,
  homeCupsRemaining: cups,
  awayCupsRemaining: 0,
  endType: "REGULAR" as const,
});

async function snapshot(fx: Fixture) {
  const [matches, t, audits, events] = await Promise.all([
    db.match.findMany({ where: { tournamentId: fx.t.id }, orderBy: { orderIndex: "asc" } }),
    getTournament(fx),
    db.auditLog.count(),
    db.matchEvent.count(),
  ]);
  return { matches, revision: t.revision, status: t.status, champion: t.championTeamId, audits, events };
}

describe("correctResult", () => {
  it("corrects a group result: stats change, event + audit with reason", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await seedGroupResults(fx);
    const m = await getMatch(fx, "A-1"); // position 1 beat position 2 5:0
    const before = await loadTournamentState(db, fx.t.id);
    const rowBefore = before.standings
      .find((s) => s.group === "A")!
      .rows.find((r) => r.teamId === m.homeTeamId)!;

    const r = await correctResult(fx.admin, {
      matchId: m.id,
      expectedVersion: m.version,
      reason: "Becher falsch gezählt",
      ...homeWins(m, 8),
    });
    expect(r).toMatchObject({ resultRevision: m.resultRevision + 1, reseeded: [], championTeamId: null });
    const after = await loadTournamentState(db, fx.t.id);
    const rowAfter = after.standings
      .find((s) => s.group === "A")!
      .rows.find((x) => x.teamId === m.homeTeamId)!;
    expect(rowAfter.cupsAgainst).toBe(rowBefore.cupsAgainst - 3);

    const ev = await db.matchEvent.findFirstOrThrow({ where: { matchId: m.id, type: "CORRECTED" } });
    expect(ev.payload).toMatchObject({
      before: { homeCupsRemaining: 5 },
      after: { homeCupsRemaining: 8 },
      reason: "Becher falsch gezählt",
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "match.correct" } });
    expect(audit.reason).toBe("Becher falsch gezählt");
    expect(audit.before).toMatchObject({ homeCupsRemaining: 5 });

    expect(
      await errorCode(
        correctResult(fx.admin, {
          matchId: m.id,
          expectedVersion: m.version,
          reason: "nochmal",
          ...homeWins(m),
        }),
      ),
    ).toBe("STALE_VERSION");
    expect(
      await errorCode(
        correctResult(fx.admin, {
          matchId: m.id,
          expectedVersion: r.version,
          reason: "kurz",
          ...homeWins(m),
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("only decided matches can be corrected", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const m = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        correctResult(fx.admin, {
          matchId: m.id,
          expectedVersion: m.version,
          reason: "Tippfehler",
          ...homeWins(m),
        }),
      ),
    ).toBe("INVALID_STATE");
  });

  it("voids a stale group tiebreak when a correction changes the tied stats", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await seedGroupResults(fx);
    // Turn group A into a three-way tie: position 3 beats position 1 in A-2 (3 v 1).
    const a2 = await getMatch(fx, "A-2");
    await db.match.update({ where: { id: a2.id }, data: { ...homeWins(a2, 5) } });
    const state = await loadTournamentState(db, fx.t.id);
    const tie = state.standings.find((s) => s.group === "A")!.unresolved[0];
    expect(tie.teamIds).toHaveLength(3);
    const tb = await db.groupTiebreak.create({
      data: {
        groupId: fx.groupIds.A,
        teamIds: tie.teamIds,
        orderedTeamIds: tie.teamIds,
        basisHash: tie.basisHash,
        recordedById: fx.admin.id,
      },
    });
    const a1 = await getMatch(fx, "A-1");
    await correctResult(fx.admin, {
      matchId: a1.id,
      expectedVersion: a1.version,
      reason: "Becher falsch gezählt",
      ...homeWins(a1, 7),
    });
    const after = await db.groupTiebreak.findUniqueOrThrow({ where: { id: tb.id } });
    expect(after.voidedAt).toBeInstanceOf(Date);
    expect(await db.auditLog.count({ where: { action: "tiebreak.void", entityId: tb.id } })).toBe(1);
  });

  it("QF correction before SF started re-seeds the SF slot (and unassigns an assigned SF)", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    await playMatch(fx, "QF1", { winner: "HOME" });
    await playMatch(fx, "QF3", { winner: "HOME" });
    let sf1 = await getMatch(fx, "SF1");
    expect(sf1).toMatchObject({ homeTeamId: qualifiers.A1, awayTeamId: qualifiers.C1, status: "READY" });
    await assignMatch(fx.admin, { matchId: sf1.id, tableId: fx.tables[0].id, expectedVersion: sf1.version });

    const qf1 = await getMatch(fx, "QF1");
    const r = await correctResult(fx.admin, {
      matchId: qf1.id,
      expectedVersion: qf1.version,
      reason: "Falsches Siegerteam erfasst",
      ...awayWins(qf1),
    });
    expect(r.reseeded).toEqual(["SF1"]);
    sf1 = await getMatch(fx, "SF1");
    expect(sf1).toMatchObject({
      homeTeamId: qualifiers.B2,
      awayTeamId: qualifiers.C1,
      status: "READY",
      tableId: null,
    });
    expect(await db.activeTeamMatch.count()).toBe(0);
    const types = (
      await db.matchEvent.findMany({ where: { matchId: sf1.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.type);
    expect(types.slice(-2)).toEqual(["UNASSIGNED", "ADVANCED"]);
  });

  it("QF correction after SF started → DOWNSTREAM_STARTED and nothing changes", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    await playMatch(fx, "QF1", { winner: "HOME" });
    await playMatch(fx, "QF3", { winner: "HOME" });
    await assignAndStart(fx, "SF1");
    const before = await snapshot(fx);
    const qf1 = await getMatch(fx, "QF1");
    let err: unknown;
    try {
      await correctResult(fx.admin, {
        matchId: qf1.id,
        expectedVersion: qf1.version,
        reason: "Falsches Siegerteam erfasst",
        ...awayWins(qf1),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "DOWNSTREAM_STARTED", details: { affected: ["SF1"] } });
    expect(await snapshot(fx)).toEqual(before);
  });

  it("a correction that keeps the same winner is allowed even after the SF started", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    await playMatch(fx, "QF1", { winner: "HOME" });
    await playMatch(fx, "QF3", { winner: "HOME" });
    await assignAndStart(fx, "SF1");
    const qf1 = await getMatch(fx, "QF1");
    const r = await correctResult(fx.admin, {
      matchId: qf1.id,
      expectedVersion: qf1.version,
      reason: "Becher falsch gezählt",
      ...homeWins(qf1, 6),
    });
    expect(r.reseeded).toEqual([]);
    expect((await getMatch(fx, "QF1")).homeCupsRemaining).toBe(6);
  });

  it("group correction in the knockout stage re-seeds an unstarted QF", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    // A-3 is position 2 vs 3; flip it → position 3 becomes A2 (QF2 away).
    const a3 = await getMatch(fx, "A-3");
    const r = await correctResult(fx.admin, {
      matchId: a3.id,
      expectedVersion: a3.version,
      reason: "Falsches Siegerteam erfasst",
      ...awayWins(a3),
    });
    expect(r.reseeded).toEqual(["QF2"]);
    const qf2 = await getMatch(fx, "QF2");
    expect(qf2).toMatchObject({ homeTeamId: qualifiers.B1, awayTeamId: fx.groups.A[2], status: "READY" });
  });

  it("group correction creating an unresolved tie in the knockout stage → UNRESOLVED_TIE", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    const before = await snapshot(fx);
    const a2 = await getMatch(fx, "A-2"); // position 3 (home) vs position 1 (away, won)
    expect(
      await errorCode(
        correctResult(fx.admin, {
          matchId: a2.id,
          expectedVersion: a2.version,
          reason: "Falsches Siegerteam erfasst",
          ...homeWins(a2, 5),
        }),
      ),
    ).toBe("UNRESOLVED_TIE");
    expect(await snapshot(fx)).toEqual(before);
  });

  it("correcting the final changes the champion", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"])
      await playMatch(fx, code, { winner: "HOME" });
    expect((await getTournament(fx)).championTeamId).toBe(qualifiers.A1);
    const f = await getMatch(fx, "F");
    const r = await correctResult(fx.admin, {
      matchId: f.id,
      expectedVersion: f.version,
      reason: "Falsches Siegerteam erfasst",
      ...awayWins(f),
    });
    expect(r.championTeamId).toBe(qualifiers.B1);
    expect(await getTournament(fx)).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.B1 });
  });
});

describe("recovery", () => {
  it("plans and executes: voids SF1/F, applies the correction, advances the new winner", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1"]) await playMatch(fx, code, { winner: "HOME" });
    await assignAndStart(fx, "SF2");
    const qf1 = await getMatch(fx, "QF1");

    const plan = await planRecovery(fx.admin, { matchId: qf1.id });
    expect(plan).toMatchObject({ code: "QF1", confirmText: "QF1 ZURÜCKSETZEN", resetsKnockout: false });
    expect(plan.affected.map((a) => [a.code, a.status, a.hasResult])).toEqual([
      ["SF1", "COMPLETED", true],
      ["F", "PENDING", false],
    ]);
    expect(plan.affected[0].homeTeam?.id).toBe(qualifiers.A1);

    const revBefore = (await getTournament(fx)).revision;
    const r = await executeRecovery(fx.admin, {
      matchId: qf1.id,
      expectedVersion: qf1.version,
      reason: "Falsches Siegerteam im Viertelfinal",
      confirmText: "QF1 ZURÜCKSETZEN",
      newResult: awayWins(qf1),
    });
    expect(r.voided).toEqual(["F", "SF1"]);
    expect(r.reseeded).toEqual(["SF1"]);
    expect(r.tournamentStatus).toBe("KNOCKOUT_STAGE");

    const sf1 = await getMatch(fx, "SF1");
    expect(sf1).toMatchObject({
      status: "READY",
      homeTeamId: qualifiers.B2,
      awayTeamId: qualifiers.C1,
      winnerTeamId: null,
      confirmedAt: null,
      startedAt: null,
      tableId: null,
    });
    const f = await getMatch(fx, "F");
    expect(f).toMatchObject({ status: "PENDING", homeTeamId: null, awayTeamId: null });
    expect((await getMatch(fx, "SF2")).status).toBe("IN_PROGRESS");
    expect((await getMatch(fx, "QF1")).winnerTeamId).toBe(qualifiers.B2);

    const voidAudits = await db.auditLog.findMany({ where: { action: "match.void" } });
    expect(voidAudits).toHaveLength(2);
    const sf1Void = voidAudits.find((a) => a.entityId === sf1.id)!;
    expect(sf1Void.before).toMatchObject({ status: "COMPLETED", winnerTeamId: qualifiers.A1 });
    expect(sf1Void.reason).toBe("Falsches Siegerteam im Viertelfinal");
    expect(await db.auditLog.count({ where: { action: "match.correct", entityId: qf1.id } })).toBe(1);
    expect(await db.matchEvent.count({ where: { type: "VOIDED" } })).toBe(2);
    expect((await getTournament(fx)).revision).toBe(revBefore + 1);

    // The new SF1 can be played normally.
    const sf1Result = await playMatch(fx, "SF1", { winner: "HOME" });
    expect(sf1Result.advanced).toMatchObject({ teamId: qualifiers.B2, toCode: "F", slot: "HOME" });
  });

  it("recovery after the final reopens the tournament", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"])
      await playMatch(fx, code, { winner: "HOME" });
    expect(await getTournament(fx)).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.A1 });
    const sf2 = await getMatch(fx, "SF2"); // B1 vs D1, B1 won
    const r = await executeRecovery(fx.admin, {
      matchId: sf2.id,
      expectedVersion: sf2.version,
      reason: "Falsches Siegerteam im Halbfinal",
      confirmText: "SF2 ZURÜCKSETZEN",
      newResult: awayWins(sf2),
    });
    expect(r).toMatchObject({ voided: ["F"], tournamentStatus: "KNOCKOUT_STAGE", championTeamId: null });
    expect(await getTournament(fx)).toMatchObject({ status: "KNOCKOUT_STAGE", championTeamId: null });
    const f = await getMatch(fx, "F");
    expect(f).toMatchObject({ status: "READY", homeTeamId: qualifiers.A1, awayTeamId: qualifiers.D1 });
    expect(await db.auditLog.count({ where: { action: "tournament.recovery" } })).toBe(1);

    const final = await playMatch(fx, "F", { winner: "AWAY" });
    expect(final.championTeamId).toBe(qualifiers.D1);
    expect(await getTournament(fx)).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.D1 });
  });

  it("group recovery in the knockout stage voids the whole bracket and returns to GROUP_STAGE", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    await playMatch(fx, "QF1", { winner: "HOME" });
    await assignAndStart(fx, "QF2");
    const a2 = await getMatch(fx, "A-2");
    // Without the new result the preview cannot know about the tie: narrow scope.
    const preview = await planRecovery(fx.admin, { matchId: a2.id });
    expect(preview.resetsKnockout).toBe(false);
    expect(preview.affected.map((a) => a.code)).toEqual(["QF1", "QF2", "SF1", "SF2", "F"]);
    const plan = await planRecovery(fx.admin, { matchId: a2.id, newResult: homeWins(a2, 5) });
    expect(plan.resetsKnockout).toBe(true);
    expect(plan.affected).toHaveLength(7);
    const r = await executeRecovery(fx.admin, {
      matchId: a2.id,
      expectedVersion: a2.version,
      reason: "Falsches Siegerteam in der Gruppe",
      confirmText: "A-2 ZURÜCKSETZEN",
      newResult: homeWins(a2, 5), // creates a three-way tie in group A
    });
    expect(r.tournamentStatus).toBe("GROUP_STAGE");
    expect(r.voided).toHaveLength(7);
    const ko = await db.match.findMany({ where: { tournamentId: fx.t.id, stage: "KNOCKOUT" } });
    expect(ko.every((m) => m.status === "PENDING" && m.homeTeamId === null && m.awayTeamId === null)).toBe(
      true,
    );
    expect(await db.activeTeamMatch.count()).toBe(0);
    const state = await loadTournamentState(db, fx.t.id);
    expect(state.standings.find((s) => s.group === "A")!.unresolved).toHaveLength(1);
  });

  it("wrong confirmText → CONFIRMATION_REQUIRED, nothing changes", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    await playMatch(fx, "QF1", { winner: "HOME" });
    const before = await snapshot(fx);
    const qf1 = await getMatch(fx, "QF1");
    for (const confirmText of ["", "QF1 zurücksetzen", "QF2 ZURÜCKSETZEN"]) {
      expect(
        await errorCode(
          executeRecovery(fx.admin, {
            matchId: qf1.id,
            expectedVersion: qf1.version,
            reason: "Falsches Siegerteam",
            confirmText,
            newResult: awayWins(qf1),
          }),
        ),
      ).toBe("CONFIRMATION_REQUIRED");
    }
    expect(await snapshot(fx)).toEqual(before);
  });
});
