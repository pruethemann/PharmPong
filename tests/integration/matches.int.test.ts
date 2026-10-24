import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { correctResult, executeRecovery } from "@/server/services/corrections";
import {
  abortMatch,
  assignMatch,
  hasOpenIssue,
  pauseMatch,
  reportIssue,
  resolveIssue,
  resumeMatch,
  startMatch,
  unassignMatch,
} from "@/server/services/matches";
import { forfeitMatch, proposeResult } from "@/server/services/results";
import {
  assertInvariants,
  buildDrawnTournament,
  errorCode,
  getMatch,
  idemKey,
  type Fixture,
} from "./match-fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let current: Fixture | null = null;

async function setup() {
  current = await buildDrawnTournament();
  return current;
}

afterEach(async () => {
  if (current) await assertInvariants(current.t.id);
  current = null;
});

describe("match lifecycle", () => {
  it("assign → start → pause → resume → unassign rules and timestamps", async () => {
    const fx = await setup();
    const [t1] = fx.tables;
    const m0 = await getMatch(fx, "A-1");
    const a = await assignMatch(fx.referee, { matchId: m0.id, tableId: t1.id, expectedVersion: m0.version });
    expect(a).toMatchObject({ status: "ASSIGNED", version: m0.version + 1, override: false });
    let m = await getMatch(fx, "A-1");
    expect(m.tableId).toBe(t1.id);
    expect(m.assignedAt).toBeInstanceOf(Date);
    expect(await db.activeTeamMatch.count({ where: { matchId: m.id } })).toBe(2);

    // Unassign before start → READY again, locks released.
    const u = await unassignMatch(fx.referee, { matchId: m.id, expectedVersion: a.version });
    expect(u.status).toBe("READY");
    m = await getMatch(fx, "A-1");
    expect(m.tableId).toBeNull();
    expect(m.assignedAt).toBeNull();
    expect(await db.activeTeamMatch.count({ where: { matchId: m.id } })).toBe(0);

    const a2 = await assignMatch(fx.referee, { matchId: m.id, tableId: t1.id, expectedVersion: u.version });
    const s = await startMatch(fx.referee, { matchId: m.id, expectedVersion: a2.version });
    expect(s.status).toBe("IN_PROGRESS");
    m = await getMatch(fx, "A-1");
    expect(m.startedAt?.toISOString()).toBe(s.startedAt);
    expect(m.refereeId).toBe(fx.referee.id);
    expect(m.pausedDurationMs).toBe(0);

    // Unassign after start is not possible.
    expect(await errorCode(unassignMatch(fx.admin, { matchId: m.id, expectedVersion: m.version }))).toBe(
      "INVALID_STATE",
    );

    const p = await pauseMatch(fx.referee, { matchId: m.id, expectedVersion: s.version });
    m = await getMatch(fx, "A-1");
    expect(m.pausedAt).toBeInstanceOf(Date);
    expect(await errorCode(pauseMatch(fx.referee, { matchId: m.id, expectedVersion: p.version }))).toBe(
      "INVALID_STATE",
    );
    await sleep(60);
    const r = await resumeMatch(fx.referee, { matchId: m.id, expectedVersion: p.version });
    expect(r.pausedDurationMs).toBeGreaterThanOrEqual(50);
    m = await getMatch(fx, "A-1");
    expect(m.pausedAt).toBeNull();
    expect(await errorCode(resumeMatch(fx.referee, { matchId: m.id, expectedVersion: r.version }))).toBe(
      "INVALID_STATE",
    );

    const events = await db.matchEvent.findMany({ where: { matchId: m.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual([
      "ASSIGNED",
      "UNASSIGNED",
      "ASSIGNED",
      "STARTED",
      "PAUSED",
      "RESUMED",
    ]);
    const t = await db.tournament.findUniqueOrThrow({ where: { id: fx.t.id } });
    expect(t.revision).toBe(6);
  });

  it("propose folds a running pause into pausedDurationMs and stops the clock", async () => {
    const fx = await setup();
    const m0 = await getMatch(fx, "A-1");
    const a = await assignMatch(fx.admin, { matchId: m0.id, tableId: fx.tables[0].id, expectedVersion: 0 });
    const s = await startMatch(fx.referee, { matchId: m0.id, expectedVersion: a.version });
    const p = await pauseMatch(fx.referee, { matchId: m0.id, expectedVersion: s.version });
    await sleep(40);
    await proposeResult(fx.referee, {
      matchId: m0.id,
      expectedVersion: p.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m0.homeTeamId!,
      homeCupsRemaining: 2,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    const m = await getMatch(fx, "A-1");
    expect(m.pausedAt).toBeNull();
    expect(m.pausedDurationMs).toBeGreaterThanOrEqual(30);
    expect(m.endedAt).toBeInstanceOf(Date);
  });

  it("stale expectedVersion → STALE_VERSION", async () => {
    const fx = await setup();
    const m0 = await getMatch(fx, "A-1");
    await assignMatch(fx.referee, { matchId: m0.id, tableId: fx.tables[0].id, expectedVersion: 0 });
    expect(await errorCode(startMatch(fx.referee, { matchId: m0.id, expectedVersion: 0 }))).toBe(
      "STALE_VERSION",
    );
  });
});

describe("assignment rules", () => {
  it("referee may only assign the suggested match for that table; admin can override", async () => {
    const fx = await setup();
    const [t1, t2] = fx.tables;
    const a1 = await getMatch(fx, "A-1"); // suggested for table 1
    const b1 = await getMatch(fx, "B-1"); // suggested for table 2
    const c1 = await getMatch(fx, "C-1"); // not suggested

    expect(
      await errorCode(assignMatch(fx.referee, { matchId: c1.id, tableId: t1.id, expectedVersion: 0 })),
    ).toBe("FORBIDDEN");
    // The right match on the wrong table is not the suggestion either.
    expect(
      await errorCode(assignMatch(fx.referee, { matchId: b1.id, tableId: t1.id, expectedVersion: 0 })),
    ).toBe("FORBIDDEN");
    await assignMatch(fx.referee, { matchId: a1.id, tableId: t1.id, expectedVersion: 0 });

    const ov = await assignMatch(fx.admin, { matchId: c1.id, tableId: t2.id, expectedVersion: 0 });
    expect(ov.override).toBe(true);
    const ev = await db.matchEvent.findFirstOrThrow({ where: { matchId: c1.id, type: "ASSIGNED" } });
    expect(ev.payload).toMatchObject({ override: true, tableNumber: 2 });
    const audit = await db.auditLog.findMany({ where: { entityId: c1.id, action: "match.assign" } });
    expect(audit).toHaveLength(1);
  });

  it("admin cannot assign a match whose team is busy, nor a pending knockout match", async () => {
    const fx = await setup();
    const [t1, t2] = fx.tables;
    const a1 = await getMatch(fx, "A-1");
    await assignMatch(fx.admin, { matchId: a1.id, tableId: t1.id, expectedVersion: 0 });
    const a2 = await getMatch(fx, "A-2"); // shares a team with A-1
    expect(
      await errorCode(assignMatch(fx.admin, { matchId: a2.id, tableId: t2.id, expectedVersion: 0 })),
    ).toBe("TEAM_BUSY");
    const qf = await getMatch(fx, "QF1");
    expect(
      await errorCode(assignMatch(fx.admin, { matchId: qf.id, tableId: t2.id, expectedVersion: 0 })),
    ).toBe("INVALID_TRANSITION");
    const b1 = await getMatch(fx, "B-1");
    expect(
      await errorCode(assignMatch(fx.admin, { matchId: b1.id, tableId: t1.id, expectedVersion: 0 })),
    ).toBe("TABLE_BUSY");
  });

  it("disabled table → TABLE_DISABLED", async () => {
    const fx = await setup();
    await db.gameTable.update({ where: { id: fx.tables[0].id }, data: { isDisabled: true } });
    const a1 = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        assignMatch(fx.admin, { matchId: a1.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      ),
    ).toBe("TABLE_DISABLED");
  });

  it("paused tournament blocks assign and start", async () => {
    const fx = await setup();
    const a1 = await getMatch(fx, "A-1");
    const a = await assignMatch(fx.admin, { matchId: a1.id, tableId: fx.tables[0].id, expectedVersion: 0 });
    await db.tournament.update({ where: { id: fx.t.id }, data: { isPaused: true, pausedAt: new Date() } });
    expect(await errorCode(startMatch(fx.referee, { matchId: a1.id, expectedVersion: a.version }))).toBe(
      "TOURNAMENT_PAUSED",
    );
    const b1 = await getMatch(fx, "B-1");
    expect(
      await errorCode(
        assignMatch(fx.admin, { matchId: b1.id, tableId: fx.tables[1].id, expectedVersion: 0 }),
      ),
    ).toBe("TOURNAMENT_PAUSED");
  });

  it("assign is only possible in a play phase", async () => {
    const fx = await setup();
    await db.tournament.update({ where: { id: fx.t.id }, data: { status: "REGISTRATION_LOCKED" } });
    const a1 = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        assignMatch(fx.admin, { matchId: a1.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      ),
    ).toBe("INVALID_STATE");
  });
});

describe("abort and issues", () => {
  it("admin abort takes an in-progress match back to READY and clears everything", async () => {
    const fx = await setup();
    const m0 = await getMatch(fx, "A-1");
    const a = await assignMatch(fx.admin, { matchId: m0.id, tableId: fx.tables[0].id, expectedVersion: 0 });
    await startMatch(fx.referee, { matchId: m0.id, expectedVersion: a.version });
    const r = await abortMatch(fx.admin, { matchId: m0.id, reason: "Falsch gestartet" });
    expect(r.status).toBe("READY");
    const m = await getMatch(fx, "A-1");
    expect(m).toMatchObject({ tableId: null, startedAt: null, refereeId: null, pausedDurationMs: 0 });
    expect(await db.activeTeamMatch.count()).toBe(0);
    const ev = await db.matchEvent.findFirstOrThrow({ where: { matchId: m.id, type: "ABORTED" } });
    expect(ev.payload).toMatchObject({ reason: "Falsch gestartet", from: "IN_PROGRESS" });
    expect(await errorCode(abortMatch(fx.admin, { matchId: m.id, reason: "nochmal" }))).toBe("INVALID_STATE");
  });

  it("referee reports an issue, admin resolves it", async () => {
    const fx = await setup();
    const m = await getMatch(fx, "A-1");
    expect(await hasOpenIssue(db, m.id)).toBe(false);
    expect(await errorCode(reportIssue(fx.referee, { matchId: m.id, text: "x" }))).toBe("VALIDATION");
    await reportIssue(fx.referee, { matchId: m.id, text: "Tisch wackelt stark" });
    expect(await hasOpenIssue(db, m.id)).toBe(true);
    expect(await errorCode(resolveIssue(fx.referee, { matchId: m.id, note: "ok" }))).toBe("FORBIDDEN");
    await sleep(5);
    await resolveIssue(fx.admin, { matchId: m.id, note: "Tisch getauscht" });
    expect(await hasOpenIssue(db, m.id)).toBe(false);
    expect(await errorCode(resolveIssue(fx.admin, { matchId: m.id }))).toBe("INVALID_STATE");
  });
});

describe("authorization", () => {
  it("PLAYER cannot assign, start or propose", async () => {
    const fx = await setup();
    const m = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        assignMatch(fx.player, { matchId: m.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      ),
    ).toBe("FORBIDDEN");
    expect(await errorCode(startMatch(fx.player, { matchId: m.id, expectedVersion: 0 }))).toBe("FORBIDDEN");
    expect(
      await errorCode(
        proposeResult(fx.player, {
          matchId: m.id,
          expectedVersion: 0,
          idempotencyKey: idemKey(),
          winnerTeamId: m.homeTeamId!,
          homeCupsRemaining: 1,
          awayCupsRemaining: 0,
          endType: "REGULAR",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(await errorCode(reportIssue(fx.player, { matchId: m.id, text: "Hallo Welt" }))).toBe("FORBIDDEN");
  });

  it("REFEREE cannot forfeit, abort or correct", async () => {
    const fx = await setup();
    const m = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        forfeitMatch(fx.referee, { matchId: m.id, winnerTeamId: m.homeTeamId!, reason: "abwesend" }),
      ),
    ).toBe("FORBIDDEN");
    expect(await errorCode(abortMatch(fx.referee, { matchId: m.id, reason: "Fehler" }))).toBe("FORBIDDEN");
    expect(
      await errorCode(
        correctResult(fx.referee, {
          matchId: m.id,
          expectedVersion: 0,
          reason: "Tippfehler",
          winnerTeamId: m.homeTeamId!,
          homeCupsRemaining: 1,
          awayCupsRemaining: 0,
          endType: "REGULAR",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        executeRecovery(fx.referee, {
          matchId: m.id,
          expectedVersion: 0,
          reason: "Tippfehler",
          confirmText: "A-1 ZURÜCKSETZEN",
          newResult: {
            winnerTeamId: m.homeTeamId!,
            homeCupsRemaining: 1,
            awayCupsRemaining: 0,
            endType: "REGULAR",
          },
        }),
      ),
    ).toBe("FORBIDDEN");
    // Nothing was written.
    expect(await db.auditLog.count()).toBe(0);
  });
});
