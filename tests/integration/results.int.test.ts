import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { confirmResult, forfeitMatch, proposeResult, rejectProposal } from "@/server/services/results";
import {
  assertInvariants,
  assignAndStart,
  buildDrawnTournament,
  buildKnockoutTournament,
  errorCode,
  getMatch,
  getTournament,
  idemKey,
  playMatch,
  type Fixture,
} from "./match-fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let current: Fixture | null = null;

afterEach(async () => {
  if (current) await assertInvariants(current.t.id);
  current = null;
});

async function groupFixture() {
  current = await buildDrawnTournament();
  return current;
}
async function koFixture() {
  const r = await buildKnockoutTournament();
  current = r.fx;
  return r;
}

describe("propose → confirm", () => {
  it("confirms a group result, releases the teams, writes events and audit", async () => {
    const fx = await groupFixture();
    const m = await assignAndStart(fx, "A-1");
    expect(await db.activeTeamMatch.count({ where: { matchId: m.id } })).toBe(2);
    const p = await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.awayTeamId!,
      homeCupsRemaining: 0,
      awayCupsRemaining: 4,
      endType: "REGULAR",
    });
    expect(p).toMatchObject({ status: "AWAITING_CONFIRMATION", resultRevision: 1, version: m.version + 1 });
    let row = await getMatch(fx, "A-1");
    expect(row.endedAt).toBeInstanceOf(Date);
    expect(row.proposedById).toBe(fx.referee.id);
    expect(row.confirmedAt).toBeNull();
    // Teams stay locked while awaiting confirmation.
    expect(await db.activeTeamMatch.count({ where: { matchId: m.id } })).toBe(2);

    const c = await confirmResult(fx.referees[1], {
      matchId: m.id,
      expectedVersion: p.version,
      resultRevision: p.resultRevision,
      idempotencyKey: idemKey(),
    });
    expect(c).toMatchObject({ status: "COMPLETED", advanced: null, championTeamId: null });
    row = await getMatch(fx, "A-1");
    expect(row).toMatchObject({
      status: "COMPLETED",
      winnerTeamId: m.awayTeamId,
      homeCupsRemaining: 0,
      awayCupsRemaining: 4,
      endType: "REGULAR",
      confirmedById: fx.referees[1].id,
      tableId: fx.tables[0].id, // kept for history
    });
    expect(await db.activeTeamMatch.count()).toBe(0);
    const types = (
      await db.matchEvent.findMany({ where: { matchId: m.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.type);
    expect(types).toEqual(["ASSIGNED", "STARTED", "PROPOSED", "CONFIRMED"]);
    expect(await db.auditLog.count({ where: { entityId: m.id, action: "match.confirm" } })).toBe(1);
  });

  it("confirm with a stale resultRevision → STALE_VERSION", async () => {
    const fx = await groupFixture();
    const m = await assignAndStart(fx, "A-1");
    const p = await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    expect(
      await errorCode(
        confirmResult(fx.referee, {
          matchId: m.id,
          expectedVersion: p.version,
          resultRevision: p.resultRevision - 1,
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("STALE_VERSION");
  });

  it("reject returns to IN_PROGRESS, clears the proposal, the clock continues", async () => {
    const fx = await groupFixture();
    const m = await assignAndStart(fx, "A-1");
    const p = await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    await sleep(50);
    const r = await rejectProposal(fx.referees[1], { matchId: m.id, expectedVersion: p.version });
    expect(r.status).toBe("IN_PROGRESS");
    const row = await getMatch(fx, "A-1");
    expect(row).toMatchObject({
      winnerTeamId: null,
      homeCupsRemaining: null,
      awayCupsRemaining: null,
      endType: null,
      proposedAt: null,
      endedAt: null,
      pausedAt: null,
    });
    expect(row.pausedDurationMs).toBeGreaterThanOrEqual(40);
    // A new proposal gets a new revision; the old revision cannot be confirmed.
    const p2 = await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: r.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.awayTeamId!,
      homeCupsRemaining: 3,
      awayCupsRemaining: 5,
      endType: "TIME_LIMIT",
    });
    expect(p2.resultRevision).toBe(2);
    expect(
      await errorCode(
        confirmResult(fx.referee, {
          matchId: m.id,
          expectedVersion: p2.version,
          resultRevision: p.resultRevision,
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("STALE_VERSION");
  });

  it("rejects invalid results with INVALID_RESULT and FORFEIT for referees", async () => {
    const fx = await groupFixture();
    const m = await assignAndStart(fx, "A-1");
    const base = { matchId: m.id, expectedVersion: m.version, winnerTeamId: m.homeTeamId! };
    const cases = [
      { homeCupsRemaining: 3, awayCupsRemaining: 2, endType: "REGULAR" as const }, // loser has cups
      { homeCupsRemaining: 2, awayCupsRemaining: 4, endType: "TIME_LIMIT" as const }, // winner not ahead
      { homeCupsRemaining: 3, awayCupsRemaining: 2, endType: "SHOOTOUT" as const }, // unequal
      { homeCupsRemaining: 10, awayCupsRemaining: 0, endType: "FORFEIT" as const }, // admin only
    ];
    for (const c of cases) {
      expect(await errorCode(proposeResult(fx.referee, { ...base, ...c, idempotencyKey: idemKey() }))).toBe(
        "INVALID_RESULT",
      );
    }
    expect((await getMatch(fx, "A-1")).status).toBe("IN_PROGRESS");
    // A valid shootout passes.
    const ok = await proposeResult(fx.referee, {
      ...base,
      homeCupsRemaining: 2,
      awayCupsRemaining: 2,
      endType: "SHOOTOUT",
      idempotencyKey: idemKey(),
    });
    expect(ok.status).toBe("AWAITING_CONFIRMATION");
  });

  it("cannot propose for a match that was not started", async () => {
    const fx = await groupFixture();
    const m = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        proposeResult(fx.referee, {
          matchId: m.id,
          expectedVersion: m.version,
          idempotencyKey: idemKey(),
          winnerTeamId: m.homeTeamId!,
          homeCupsRemaining: 1,
          awayCupsRemaining: 0,
          endType: "REGULAR",
        }),
      ),
    ).toBe("INVALID_TRANSITION");
  });

  it("proposing and confirming stay allowed while the tournament is paused", async () => {
    const fx = await groupFixture();
    const m = await assignAndStart(fx, "A-1");
    await db.tournament.update({ where: { id: fx.t.id }, data: { isPaused: true, pausedAt: new Date() } });
    const p = await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    const c = await confirmResult(fx.referee, {
      matchId: m.id,
      expectedVersion: p.version,
      resultRevision: p.resultRevision,
      idempotencyKey: idemKey(),
    });
    expect(c.status).toBe("COMPLETED");
  });
});

describe("knockout advancement", () => {
  it("QF winner goes to the right SF slot; SF READY only when both are filled", async () => {
    const { fx, qualifiers } = await koFixture();
    // QF3 (C1–D2) feeds SF1 AWAY.
    const qf3 = await playMatch(fx, "QF3", { winner: "AWAY" });
    expect(qf3.advanced).toEqual({ teamId: qualifiers.D2, toCode: "SF1", slot: "AWAY", nextReady: false });
    let sf1 = await getMatch(fx, "SF1");
    expect(sf1).toMatchObject({ homeTeamId: null, awayTeamId: qualifiers.D2, status: "PENDING" });

    const qf1 = await playMatch(fx, "QF1", { winner: "HOME" });
    expect(qf1.advanced).toMatchObject({
      teamId: qualifiers.A1,
      toCode: "SF1",
      slot: "HOME",
      nextReady: true,
    });
    sf1 = await getMatch(fx, "SF1");
    expect(sf1).toMatchObject({ homeTeamId: qualifiers.A1, awayTeamId: qualifiers.D2, status: "READY" });
    const adv = await db.matchEvent.findMany({ where: { matchId: sf1.id, type: "ADVANCED" } });
    expect(adv.map((e) => e.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamId: qualifiers.D2, toCode: "SF1", slot: "AWAY" }),
        expect.objectContaining({ teamId: qualifiers.A1, toCode: "SF1", slot: "HOME" }),
      ]),
    );
  });

  it("a proposal alone does not fill the next slot", async () => {
    const { fx } = await koFixture();
    const m = await assignAndStart(fx, "QF1");
    await proposeResult(fx.referee, {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    const sf1 = await getMatch(fx, "SF1");
    expect(sf1.homeTeamId).toBeNull();
    expect(await db.matchEvent.count({ where: { matchId: sf1.id } })).toBe(0);
  });

  it("final confirmation crowns the champion and completes the tournament", async () => {
    const { fx, qualifiers } = await koFixture();
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2"])
      await playMatch(fx, code, { winner: "HOME" });
    const f = await getMatch(fx, "F");
    expect(f).toMatchObject({ status: "READY", homeTeamId: qualifiers.A1, awayTeamId: qualifiers.B1 });
    const r = await playMatch(fx, "F", {
      winner: "AWAY",
      winnerCups: 2,
      loserCups: 1,
      endType: "TIME_LIMIT",
    });
    expect(r.championTeamId).toBe(qualifiers.B1);
    const t = await getTournament(fx);
    expect(t).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.B1 });
    const champ = await db.matchEvent.findFirstOrThrow({ where: { matchId: f.id, type: "CHAMPION" } });
    expect(champ.payload).toEqual({ teamId: qualifiers.B1 });
    expect(await db.auditLog.count({ where: { action: "tournament.complete" } })).toBe(1);
  });

  it("forfeit counts 10:0, releases the teams and advances", async () => {
    const { fx, qualifiers } = await koFixture();
    const m = await assignAndStart(fx, "QF2");
    expect(
      await errorCode(
        forfeitMatch(fx.admin, { matchId: m.id, winnerTeamId: "someone-else", reason: "abwesend" }),
      ),
    ).toBe("INVALID_RESULT");
    const r = await forfeitMatch(fx.admin, {
      matchId: m.id,
      winnerTeamId: m.awayTeamId!,
      reason: "Team abwesend",
    });
    expect(r.status).toBe("FORFEITED");
    expect(r.advanced).toMatchObject({ teamId: qualifiers.A2, toCode: "SF2", slot: "HOME" });
    const row = await getMatch(fx, "QF2");
    expect(row).toMatchObject({
      winnerTeamId: m.awayTeamId,
      homeCupsRemaining: 0,
      awayCupsRemaining: 10,
      endType: "FORFEIT",
      confirmedById: fx.admin.id,
    });
    expect(row.endedAt).toBeInstanceOf(Date);
    expect(await db.activeTeamMatch.count()).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "match.forfeit" } });
    expect(audit.reason).toBe("Team abwesend");
    // A decided match cannot be forfeited again.
    expect(
      await errorCode(
        forfeitMatch(fx.admin, { matchId: m.id, winnerTeamId: m.homeTeamId!, reason: "nochmal" }),
      ),
    ).toBe("INVALID_STATE");
  });

  it("forfeit of a READY group match works without a table", async () => {
    const fx = await groupFixture();
    const m = await getMatch(fx, "B-2");
    const r = await forfeitMatch(fx.admin, {
      matchId: m.id,
      winnerTeamId: m.homeTeamId!,
      reason: "abwesend",
    });
    expect(r).toMatchObject({ status: "FORFEITED", advanced: null });
    expect((await getMatch(fx, "B-2")).tableId).toBeNull();
  });
});
