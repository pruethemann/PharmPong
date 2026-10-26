// Elo match lifecycle through the real services: drafts, consent, tables and player locks,
// expiry, start, stopwatch, cancel/leave/abandon (spec §4, §5).
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  abandonEloMatch,
  cancelEloMatch,
  consentEloRoster,
  createEloMatch,
  leaveEloMatch,
  pauseEloMatch,
  resumeEloMatch,
  staffConsentEloRoster,
  startEloMatch,
  updateEloRoster,
} from "@/server/services/elo-matches";
import { setEloSessionStatus, updateEloSettings } from "@/server/services/elo-session";
import { submitEloResult } from "@/server/services/elo-results";
import { setGameMode } from "@/server/services/game-mode";
import { actorOf, errorCode } from "./match-fixtures";
import {
  assertEloInvariants,
  draftMatch,
  eloEvent,
  ids,
  matchRow,
  playEloMatch,
  startedMatch,
  type EloFx,
} from "./elo-fixtures";

let fx: EloFx | null = null;
afterEach(async () => {
  if (fx) await assertEloInvariants(fx.session.id);
  fx = null;
});

describe("creating a match", () => {
  it("plays a full match and moves the ratings exactly as in spec example A", async () => {
    fx = await eloEvent();
    const [a1, a2, b1, b2] = fx.players;
    const { matchId, confirmed } = await playEloMatch(fx, [a1, a2], [b1, b2], "A");
    expect(confirmed.status).toBe("COMPLETED");
    expect(confirmed.confirmed).toMatchObject({ sequence: 1, rated: true, multiplier: 1, effective: true });
    expect(confirmed.confirmed!.changes.map((c) => [c.side, c.delta])).toEqual([
      ["A", 6],
      ["A", 6],
      ["B", -6],
      ["B", -6],
    ]);
    const ratings = await db.eloPlayerRating.findMany({
      where: { sessionId: fx.session.id },
      orderBy: { rating: "desc" },
    });
    expect(ratings.map((r) => [r.rating, r.gamesPlayed, r.wins, r.losses])).toEqual([
      [106, 1, 1, 0],
      [106, 1, 1, 0],
      [94, 1, 0, 1],
      [94, 1, 0, 1],
    ]);
    const m = await matchRow(matchId);
    expect(m).toMatchObject({ confirmedSequence: 1, ratingMultiplier: 1, expectedScoreA: 0.5 });
    const revisions = await db.eloMatchResultRevision.findMany({
      where: { matchId },
      orderBy: { revision: "asc" },
    });
    expect(revisions.map((r) => [r.revision, r.kind, r.status])).toEqual([
      [1, "SUBMITTED", "AWAITING_CONFIRMATION"],
      [2, "CONFIRMED", "COMPLETED"],
    ]);
    const events = await db.eloMatchEvent.findMany({ where: { matchId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual([
      "CREATED",
      "CONSENTED",
      "STARTED",
      "RESULT_SUBMITTED",
      "RESULT_CONFIRMED",
    ]);
  });

  it("consents the creator's own side automatically and waits for the other side", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const created = await draftMatch(fx, [a], [b], { consent: false });
    const m = await matchRow(created.matchId);
    expect(m.consentAHash).toBe(created.rosterHash);
    expect(m.consentAMethod).toBe("CREATOR");
    expect(m.consentBHash).toBeNull();
    expect(await errorCode(startEloMatch(actorOf(a), { matchId: m.id, expectedVersion: m.version }))).toBe(
      "INVALID_STATE",
    );
    // The creator cannot confirm for the other side; a stranger cannot confirm at all.
    expect(await errorCode(consentEloRoster(actorOf(a), { matchId: m.id, rosterHash: m.rosterHash }))).toBe(
      "INVALID_STATE",
    );
    expect(
      await errorCode(consentEloRoster(actorOf(fx.players[5]), { matchId: m.id, rosterHash: m.rosterHash })),
    ).toBe("FORBIDDEN");
    // A stale roster hash is refused: consent always refers to the roster the player saw.
    expect(await errorCode(consentEloRoster(actorOf(b), { matchId: m.id, rosterHash: "old" }))).toBe(
      "ROSTER_CHANGED",
    );
    const ok = await consentEloRoster(actorOf(b), { matchId: m.id, rosterHash: m.rosterHash });
    expect(ok.ready).toBe(true);
  });

  it("needs the creator to play in the match, unless the creator is staff", async () => {
    fx = await eloEvent();
    const [a, b, c] = fx.players;
    expect(
      await errorCode(
        createEloMatch(
          actorOf(c),
          { tableId: fx.tables[0].id, sideA: [a.id], sideB: [b.id], rated: true },
          fx.opts,
        ),
      ),
    ).toBe("FORBIDDEN");
    const byRef = await createEloMatch(
      actorOf(fx.referee),
      { tableId: fx.tables[0].id, sideA: [a.id], sideB: [b.id], rated: true },
      fx.opts,
    );
    const m = await matchRow(byRef.matchId);
    expect([m.consentAHash, m.consentBHash]).toEqual([null, null]);
    // The referee records in-person consent of both sides (audited).
    const r = await staffConsentEloRoster(actorOf(fx.referee), {
      matchId: m.id,
      rosterHash: m.rosterHash,
      sides: ["A", "B"],
    });
    expect(r.ready).toBe(true);
    expect(await db.auditLog.count({ where: { action: "elo.match.staff_consent", entityId: m.id } })).toBe(1);
  });

  it("enforces team sizes 1–4 and the session limits on the server", async () => {
    fx = await eloEvent(12);
    const p = fx.players;
    const create = (sideA: string[], sideB: string[]) =>
      createEloMatch(actorOf(p[0]), { tableId: fx!.tables[0].id, sideA, sideB, rated: true }, fx!.opts);
    expect(await errorCode(create(ids(p.slice(0, 5)), [p[5].id]))).toBe("VALIDATION");
    expect(await errorCode(create([p[0].id], []))).toBe("VALIDATION");
    expect(await errorCode(create([p[0].id, p[1].id], [p[1].id]))).toBe("VALIDATION");
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    await updateEloSettings(
      actorOf(fx.admin),
      {
        sessionId: s.id,
        expectedConfigVersion: s.configVersion,
        settings: {
          minTeamSize: 2,
          maxTeamSize: 2,
          minGamesForChampion: 3,
          softReminderMinutes: 20,
          resultPolicy: "DUAL_TEAM_CONFIRMATION",
        },
      },
      fx.opts,
    );
    expect(await errorCode(create([p[0].id], [p[1].id, p[2].id]))).toBe("VALIDATION");
    expect(await errorCode(create([p[0].id, p[3].id], [p[1].id, p[2].id]))).toBe("RESOLVED");
  });

  it("only works in Elo Mode with an open session", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    await setEloSessionStatus(
      actorOf(fx.admin),
      { sessionId: s.id, expectedConfigVersion: s.configVersion, status: "PAUSED" },
      fx.opts,
    );
    const make = () =>
      createEloMatch(
        actorOf(a),
        { tableId: fx!.tables[0].id, sideA: [a.id], sideB: [b.id], rated: true },
        fx!.opts,
      );
    expect(await errorCode(make())).toBe("SESSION_NOT_OPEN");
    const paused = await db.eloSession.findUniqueOrThrow({ where: { id: s.id } });
    await setEloSessionStatus(
      actorOf(fx.admin),
      { sessionId: s.id, expectedConfigVersion: paused.configVersion, status: "OPEN" },
      fx.opts,
    );
    await setGameMode(actorOf(fx.admin), { mode: "COMPETITIVE" }, fx.opts);
    expect(await errorCode(make())).toBe("WRONG_MODE");
  });
});

describe("tables and players", () => {
  it("lets each table host one live match and each player play one live match", async () => {
    fx = await eloEvent();
    const [a, b, c, d, e] = fx.players;
    await draftMatch(fx, [a], [b], { table: 0, consent: false });
    expect(await errorCode(draftMatch(fx, [c], [d], { table: 0, consent: false }))).toBe("TABLE_BUSY");
    const busy = draftMatch(fx, [c], [a], { table: 1, consent: false });
    expect(await errorCode(busy)).toBe("PLAYER_BUSY");
    await draftMatch(fx, [c], [e], { table: 1, consent: false }); // both tables in use
  });

  it("frees the table and the players as soon as a result is reported", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const matchId = await startedMatch(fx, [a], [b]);
    const m = await matchRow(matchId);
    await submitEloResult(actorOf(a), {
      matchId,
      expectedVersion: m.version,
      winnerSide: "A",
      endType: "REGULAR",
      idempotencyKey: "k-free-table-1",
    });
    expect(await db.eloActivePlayer.count()).toBe(0);
    // Next group on the same table, with a player whose result still awaits confirmation.
    await draftMatch(fx, [a, c], [d], { table: 0 });
  });

  it("expires abandoned drafts lazily on the next Elo write", async () => {
    fx = await eloEvent();
    const [a, b, c] = fx.players;
    const old = await draftMatch(fx, [a], [b], { table: 0, consent: false });
    await db.eloMatch.update({
      where: { id: old.matchId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await draftMatch(fx, [c], [a], { table: 0, consent: false }); // same table and same player: free again
    const expired = await matchRow(old.matchId);
    expect(expired).toMatchObject({ status: "CANCELLED", cancelReason: "EXPIRED" });
    expect(await db.eloMatchEvent.count({ where: { matchId: old.matchId, type: "EXPIRED" } })).toBe(1);
  });

  it("refuses disabled tables", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    await db.gameTable.update({ where: { id: fx.tables[0].id }, data: { isDisabled: true } });
    expect(await errorCode(draftMatch(fx, [a], [b], { table: 0 }))).toBe("TABLE_DISABLED");
  });
});

describe("changing a draft", () => {
  it("re-confirms the creator's side on edit and invalidates the other side's consent", async () => {
    fx = await eloEvent();
    const [a, b, c] = fx.players;
    const created = await draftMatch(fx, [a], [b]); // b consented
    const m = await matchRow(created.matchId);
    const edited = await updateEloRoster(actorOf(a), {
      matchId: m.id,
      expectedVersion: m.version,
      sideA: [a.id, c.id],
      sideB: [b.id],
      rated: true,
    });
    const after = await matchRow(m.id);
    expect(after.rosterHash).toBe(edited.rosterHash);
    expect(after.consentAHash).toBe(edited.rosterHash);
    expect(after.consentBHash).toBeNull();
    expect(await db.eloActivePlayer.count({ where: { matchId: m.id } })).toBe(3);
    // Only the creator or staff may edit.
    expect(
      await errorCode(
        updateEloRoster(actorOf(b), {
          matchId: m.id,
          expectedVersion: after.version,
          sideA: [a.id],
          sideB: [b.id],
          rated: true,
        }),
      ),
    ).toBe("FORBIDDEN");
    // Stale version is refused.
    expect(
      await errorCode(
        updateEloRoster(actorOf(a), {
          matchId: m.id,
          expectedVersion: m.version,
          sideA: [a.id],
          sideB: [b.id],
          rated: true,
        }),
      ),
    ).toBe("STALE_VERSION");
  });

  it("lets a player leave; an emptied side cancels the draft", async () => {
    fx = await eloEvent();
    const [a, b, c] = fx.players;
    const created = await draftMatch(fx, [a], [b, c]);
    await leaveEloMatch(actorOf(c), { matchId: created.matchId });
    const m = await matchRow(created.matchId);
    expect(m.status).toBe("DRAFT");
    expect(m.consentBHash).toBeNull(); // b must confirm the new roster
    expect(m.consentAHash).toBe(m.rosterHash); // the creator's side stays confirmed
    await leaveEloMatch(actorOf(b), { matchId: m.id });
    expect((await matchRow(m.id)).status).toBe("CANCELLED");
  });

  it("lets the creator or staff cancel a draft (staff audited), not other players", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const one = await draftMatch(fx, [a], [b], { table: 0 });
    expect(await errorCode(cancelEloMatch(actorOf(b), { matchId: one.matchId }))).toBe("FORBIDDEN");
    await cancelEloMatch(actorOf(a), { matchId: one.matchId });
    const two = await draftMatch(fx, [c], [d], { table: 1 });
    await cancelEloMatch(actorOf(fx.referee), { matchId: two.matchId, reason: "Tisch wird gebraucht" });
    expect(await db.auditLog.count({ where: { action: "elo.match.cancel" } })).toBe(1);
  });
});

describe("running matches", () => {
  it("runs a count-up stopwatch with pause accounting and no time limit", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const matchId = await startedMatch(fx, [a], [b]);
    let m = await matchRow(matchId);
    expect(m.startedAt).not.toBeNull();
    expect(m.expiresAt).toBeNull(); // running matches never expire
    await pauseEloMatch(actorOf(b), { matchId, expectedVersion: m.version });
    m = await matchRow(matchId);
    expect(m.pausedAt).not.toBeNull();
    expect(await errorCode(pauseEloMatch(actorOf(a), { matchId, expectedVersion: m.version }))).toBe(
      "INVALID_STATE",
    );
    await resumeEloMatch(actorOf(a), { matchId, expectedVersion: m.version });
    m = await matchRow(matchId);
    expect(m.pausedAt).toBeNull();
    expect(m.pausedDurationMs).toBeGreaterThanOrEqual(0);
    expect(
      await errorCode(pauseEloMatch(actorOf(fx.players[4]), { matchId, expectedVersion: m.version })),
    ).toBe("FORBIDDEN");
  });

  it("snapshots ratings at the start and lets staff abandon a match without rating effect", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    await playEloMatch(fx, [a], [b], "A");
    const matchId = await startedMatch(fx, [a, c], [b, d]);
    const parts = await db.eloMatchParticipant.findMany({
      where: { matchId },
      orderBy: [{ side: "asc" }, { position: "asc" }],
    });
    expect(parts.map((p) => p.ratingAtStart)).toEqual([112, 100, 88, 100]);
    const m = await matchRow(matchId);
    expect(
      await errorCode(abandonEloMatch(actorOf(a), { matchId, expectedVersion: m.version, reason: "Weg" })),
    ).toBe("FORBIDDEN");
    await abandonEloMatch(actorOf(fx.referee), {
      matchId,
      expectedVersion: m.version,
      reason: "Spieler weg",
    });
    expect((await matchRow(matchId)).status).toBe("CANCELLED");
    expect(await db.eloRatingChange.count({ where: { matchId } })).toBe(0);
  });
});
