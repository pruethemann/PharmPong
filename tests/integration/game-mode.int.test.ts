// Game mode switching and the guards that keep the two modes apart (spec §1.2, §11.3, §11.4).
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { buildAuthedSnapshot } from "@/server/services/live-snapshot";
import { ensureTournamentForDeploy } from "@/server/services/bootstrap";
import { closeEloSession, CLOSE_CONFIRM_TEXT, reopenEloSession } from "@/server/services/elo-session";
import { cancelEloDrafts, readGameMode, setGameMode, setPublicDisplay } from "@/server/services/game-mode";
import { assignMatch, startMatch } from "@/server/services/matches";
import { setTableDisabled } from "@/server/services/tables";
import { pauseTournament, updateSettings } from "@/server/services/tournament";
import { submitEloResult } from "@/server/services/elo-results";
import { makeTournament, makeUser } from "./factories";
import { actorOf, buildDrawnTournament, errorCode, idemKey } from "./match-fixtures";
import {
  assertEloInvariants,
  draftMatch,
  eloEvent,
  matchRow,
  playEloMatch,
  startedMatch,
} from "./elo-fixtures";

describe("who may switch", () => {
  it("is admin-only", async () => {
    const t = await makeTournament();
    const [player, referee] = await Promise.all([makeUser(), makeUser({ role: "REFEREE" })]);
    for (const u of [player, referee]) {
      expect(await errorCode(setGameMode(actorOf(u), { mode: "ELO" }, { tournamentId: t.id }))).toBe(
        "FORBIDDEN",
      );
    }
    expect((await readGameMode()).gameMode).toBe("COMPETITIVE");
  });
});

describe("switching preserves everything", () => {
  it("opens one session on the first switch and restores its leaderboard after a round trip", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    await playEloMatch(fx, [a], [b], "A");
    const before = await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } });
    const off = await setGameMode(actorOf(fx.admin), { mode: "COMPETITIVE" }, fx.opts);
    expect(off).toMatchObject({ changed: true, gameMode: "COMPETITIVE", openedSession: false });
    expect((await readGameMode()).gameMode).toBe("COMPETITIVE");
    const on = await setGameMode(actorOf(fx.admin), { mode: "ELO" }, fx.opts);
    expect(on).toMatchObject({ changed: true, openedSession: false, sessionId: fx.session.id });
    expect(await db.eloSession.count()).toBe(1);
    expect(await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } })).toEqual(before);
    // Switching to the active mode is a no-op.
    expect((await setGameMode(actorOf(fx.admin), { mode: "ELO" }, fx.opts)).changed).toBe(false);
    expect(await db.auditLog.count({ where: { action: "game.mode" } })).toBe(3);
    await assertEloInvariants(fx.session.id);
  });
});

describe("blockers", () => {
  it("refuses to leave Elo Mode with open matches and offers the explicit draft cleanup", async () => {
    const fx = await eloEvent(6);
    const [a, b, c, d] = fx.players;
    await draftMatch(fx, [a], [b], { table: 0, consent: false });
    const running = await startedMatch(fx, [c], [d], { table: 1 });
    let statuses: string[] = [];
    try {
      await setGameMode(actorOf(fx.admin), { mode: "COMPETITIVE" }, fx.opts);
    } catch (e) {
      expect((e as { code: string }).code).toBe("MODE_SWITCH_BLOCKED");
      statuses = (e as { details: { blockers: { status: string }[] } }).details.blockers
        .map((x) => x.status)
        .sort();
    }
    expect(statuses).toEqual(["DRAFT", "IN_PROGRESS"]);
    // Drafts are cancelled explicitly; the running match must be finished.
    expect(
      (await cancelEloDrafts(actorOf(fx.admin), { reason: "Turnier geht weiter" }, fx.opts)).cancelled,
    ).toBe(1);
    const m = await matchRow(running);
    await submitEloResult(actorOf(c), {
      matchId: running,
      expectedVersion: m.version,
      winnerSide: "A",
      endType: "REGULAR",
      idempotencyKey: idemKey(),
    });
    // A pending result still blocks.
    expect(await errorCode(setGameMode(actorOf(fx.admin), { mode: "COMPETITIVE" }, fx.opts))).toBe(
      "MODE_SWITCH_BLOCKED",
    );
    await assertEloInvariants(fx.session.id);
  });

  it("refuses to enter Elo Mode while a competitive match is active", async () => {
    const fx = await buildDrawnTournament();
    const m = await db.match.findFirstOrThrow({
      where: { tournamentId: fx.t.id, status: "READY" },
      orderBy: { orderIndex: "asc" },
    });
    await assignMatch(fx.admin, {
      matchId: m.id,
      tableId: fx.tables[0].id,
      expectedVersion: m.version,
    });
    const blocked = setGameMode(fx.admin, { mode: "ELO" }, { tournamentId: fx.t.id });
    expect(await errorCode(blocked)).toBe("MODE_SWITCH_BLOCKED");
    expect(await db.eloSession.count()).toBe(0);
  });
});

describe("the modes stay apart", () => {
  it("refuses competitive assignments, starts and the tournament pause in Elo Mode", async () => {
    const fx = await buildDrawnTournament();
    const ready = await db.match.findMany({
      where: { tournamentId: fx.t.id, status: "READY" },
      orderBy: { orderIndex: "asc" },
    });
    // An assigned match (assigned before the mode changed behind the services' back).
    await assignMatch(fx.admin, {
      matchId: ready[0].id,
      tableId: fx.tables[0].id,
      expectedVersion: ready[0].version,
    });
    await db.tournament.update({ where: { id: fx.t.id }, data: { gameMode: "ELO" } });
    const assigned = await db.match.findUniqueOrThrow({ where: { id: ready[0].id } });
    expect(
      await errorCode(startMatch(fx.admin, { matchId: assigned.id, expectedVersion: assigned.version })),
    ).toBe("WRONG_MODE");
    expect(
      await errorCode(
        assignMatch(fx.admin, {
          matchId: ready[1].id,
          tableId: fx.tables[1].id,
          expectedVersion: ready[1].version,
        }),
      ),
    ).toBe("WRONG_MODE");
    expect(await errorCode(pauseTournament(fx.admin, {}, { tournamentId: fx.t.id }))).toBe("WRONG_MODE");
    // The competitive snapshot carries the mode and offers no assignments.
    const snap = await buildAuthedSnapshot(fx.admin, fx.t.id);
    expect(snap.gameMode).toBe("ELO");
    expect(snap.suggestions).toEqual([]);
    expect(snap.admin!.suggestions).toEqual([]);
  });

  it("cannot disable a table with a live Elo match", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    const running = await startedMatch(fx, [a], [b], { table: 0 });
    expect(await errorCode(setTableDisabled(actorOf(fx.admin), fx.tables[0].id, true, "Wackelt"))).toBe(
      "TABLE_BUSY",
    );
    const m = await matchRow(running);
    await submitEloResult(actorOf(a), {
      matchId: running,
      expectedVersion: m.version,
      winnerSide: "B",
      endType: "REGULAR",
      idempotencyKey: idemKey(),
    });
    expect((await setTableDisabled(actorOf(fx.admin), fx.tables[0].id, true, "Wackelt")).isDisabled).toBe(
      true,
    );
  });
});

describe("after the competitive final", () => {
  it("toggles the public display on a finished tournament", async () => {
    const t = await makeTournament();
    const admin = await makeUser({ role: "ADMIN" });
    await db.tournament.update({ where: { id: t.id }, data: { status: "COMPLETED" } });
    expect(
      await errorCode(updateSettings(actorOf(admin), { publicDisplayEnabled: true }, { tournamentId: t.id })),
    ).toBe("INVALID_STATE");
    expect(await setPublicDisplay(actorOf(admin), { enabled: true }, { tournamentId: t.id })).toEqual({
      publicDisplayEnabled: true,
    });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).publicDisplayEnabled).toBe(true);
  });

  it("keeps the Elo event at pre-deploy instead of opening a fresh tournament", async () => {
    const fx = await eloEvent(2);
    await db.tournament.update({ where: { id: fx.t.id }, data: { status: "COMPLETED" } });
    expect(await ensureTournamentForDeploy()).toEqual({ tournamentId: fx.t.id, keptEloEvent: true });
    expect(await db.tournament.count()).toBe(1);
    // Back in competitive mode with the session closed, a deploy opens the next tournament as before.
    await setGameMode(actorOf(fx.admin), { mode: "COMPETITIVE" }, fx.opts);
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    await closeEloSession(
      actorOf(fx.admin),
      { sessionId: s.id, expectedConfigVersion: s.configVersion, confirmText: CLOSE_CONFIRM_TEXT },
      fx.opts,
    );
    const next = await ensureTournamentForDeploy();
    expect(next.keptEloEvent).toBe(false);
    expect(next.tournamentId).not.toBe(fx.t.id);
  });

  it("reopens a closed session (audited) and withdraws the champion title", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    for (let i = 0; i < 3; i++) await playEloMatch(fx, [a], [b], "A");
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    const closed = await closeEloSession(
      actorOf(fx.admin),
      { sessionId: s.id, expectedConfigVersion: s.configVersion, confirmText: CLOSE_CONFIRM_TEXT },
      fx.opts,
    );
    expect(closed.championUserIds).toEqual([a.id]);
    const s2 = await db.eloSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(
      await errorCode(
        reopenEloSession(
          actorOf(fx.admin),
          { sessionId: s.id, expectedConfigVersion: s2.configVersion, reason: "kurz" },
          fx.opts,
        ),
      ),
    ).toBe("VALIDATION");
    await reopenEloSession(
      actorOf(fx.admin),
      { sessionId: s.id, expectedConfigVersion: s2.configVersion, reason: "Ein Match fehlte noch" },
      fx.opts,
    );
    const s3 = await db.eloSession.findUniqueOrThrow({ where: { id: s.id } });
    expect([s3.status, s3.championUserIds, s3.closedAt]).toEqual(["OPEN", [], null]);
    expect(await db.auditLog.count({ where: { action: "elo.session.reopen" } })).toBe(1);
    await assertEloInvariants(fx.session.id);
  });
});
