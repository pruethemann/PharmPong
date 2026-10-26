// Corrections, deterministic replay and session lifecycle through the real services
// (spec §3.8, §6.3, §9.2, §11.2).
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { correctEloMatch, voidCompletedEloMatch } from "@/server/services/elo-corrections";
import { abandonEloMatch } from "@/server/services/elo-matches";
import { confirmEloResult, submitEloResult } from "@/server/services/elo-results";
import { verifyRatings } from "@/server/services/elo-ratings";
import {
  CLOSE_CONFIRM_TEXT,
  closeEloSession,
  openEloSession,
  recalculateElo,
  RECALC_CONFIRM_TEXT,
  reopenEloSession,
  updateEloParams,
} from "@/server/services/elo-session";
import { DEFAULT_ELO_PARAMS } from "@/server/domain/elo/config";
import { actorOf, errorCode, idemKey } from "./match-fixtures";
import {
  assertEloInvariants,
  eloEvent,
  matchRow,
  playEloMatch,
  ratingOf,
  startedMatch,
  type EloFx,
} from "./elo-fixtures";

let fx: EloFx | null = null;
afterEach(async () => {
  if (fx) await assertEloInvariants(fx.session.id);
  fx = null;
});

/** Six players, eight confirmed matches with overlapping rosters. */
async function history(f: EloFx) {
  const [a, b, c, d, e, g] = f.players;
  const played = [];
  played.push(await playEloMatch(f, [a, b], [c, d], "A"));
  played.push(await playEloMatch(f, [a], [e, g], "B")); // corrected below
  played.push(await playEloMatch(f, [b, c], [d, e], "A"));
  played.push(await playEloMatch(f, [g], [a], "A"));
  played.push(await playEloMatch(f, [a, d, e], [b], "B"));
  played.push(await playEloMatch(f, [c], [g, b], "A"));
  played.push(await playEloMatch(f, [e], [d], "A"));
  played.push(await playEloMatch(f, [a, g], [c, b, d, e], "A"));
  return played.map((p) => p.matchId);
}

const correct = (
  f: EloFx,
  matchId: string,
  changes: Parameters<typeof correctEloMatch>[1]["changes"],
  reason = "Falsch eingetragen",
) =>
  matchRow(matchId).then((m) =>
    correctEloMatch(actorOf(f.admin), {
      matchId,
      expectedVersion: m.version,
      resultVersion: m.resultVersion,
      changes,
      reason,
      idempotencyKey: idemKey(),
    }),
  );

describe("correcting an early result replays everything after it", () => {
  it("rebuilds all downstream changes into a new run and keeps the old run as history", async () => {
    fx = await eloEvent(6);
    const matchIds = await history(fx);
    const changesBefore = await db.eloRatingChange.findMany({
      orderBy: [{ sequence: "asc" }, { userId: "asc" }],
    });
    const ratingsBefore = await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } });

    const r = await correct(fx, matchIds[1], { winnerSide: "A" });
    expect(r.runRevision).toBe(2);

    const runs = await db.eloRatingRun.findMany({
      where: { sessionId: fx.session.id },
      orderBy: { revision: "asc" },
    });
    expect(runs.map((x) => [x.revision, x.reason, x.supersededAt === null])).toEqual([
      [1, "INITIAL", false],
      [2, "CORRECTION", true],
    ]);
    // The old run's rows are untouched audit history.
    expect(await db.eloRatingChange.count({ where: { runId: runs[0].id } })).toBe(changesBefore.length);
    const newRows = await db.eloRatingChange.findMany({
      where: { runId: runs[1].id },
      orderBy: [{ sequence: "asc" }, { userId: "asc" }],
    });
    expect(newRows).toHaveLength(changesBefore.length);
    // Match 1 is unchanged; match 2 flips; later matches changed because their inputs changed.
    const key = (x: { sequence: number; userId: string; delta: number }) =>
      `${x.sequence}:${x.userId}:${x.delta}`;
    const before1 = changesBefore.filter((x) => x.sequence === 1).map(key);
    expect(newRows.filter((x) => x.sequence === 1).map(key)).toEqual(before1);
    const laterChanged = newRows.filter((x, i) => x.sequence > 2 && x.delta !== changesBefore[i].delta);
    expect(laterChanged.length).toBeGreaterThan(0);
    const ratingsAfter = await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } });
    expect(ratingsAfter.map((x) => x.rating)).not.toEqual(ratingsBefore.map((x) => x.rating));
    // The immutable revision records the previous values.
    const rev = await db.eloMatchResultRevision.findFirstOrThrow({
      where: { matchId: matchIds[1], kind: "CORRECTED" },
    });
    expect((rev.previous as { winnerSide: string }).winnerSide).toBe("B");
    expect(rev.reason).toBe("Falsch eingetragen");
  });

  it("reproduces the same ratings when replayed again", async () => {
    fx = await eloEvent(6);
    const matchIds = await history(fx);
    await correct(fx, matchIds[0], { winnerSide: "B" });
    const digest = (await verifyRatings(fx.session.id)).digest;
    const again = await recalculateElo(
      actorOf(fx.admin),
      { sessionId: fx.session.id, reason: "Kontrolle", confirmText: RECALC_CONFIRM_TEXT },
      fx.opts,
    );
    expect(again.unchanged).toBe(true);
    expect(again.digest).toBe(digest);
    expect(again.runRevision).toBe(3);
    expect(
      await errorCode(
        recalculateElo(
          actorOf(fx.admin),
          { sessionId: fx.session.id, reason: "Kontrolle", confirmText: "ja" },
          fx.opts,
        ),
      ),
    ).toBe("CONFIRMATION_REQUIRED");
  });

  it("voids a completed match and recounts the repeat schedule", async () => {
    fx = await eloEvent(4);
    const [a, b] = fx.players;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await playEloMatch(fx, [a], [b], "A")).matchId);
    expect((await matchRow(ids[2])).ratingMultiplier).toBe(0.5);
    const m = await matchRow(ids[1]);
    await voidCompletedEloMatch(
      actorOf(fx.admin),
      { matchId: ids[1], expectedVersion: m.version, reason: "Doppelt erfasst" },
      fx.opts,
    );
    expect((await matchRow(ids[1])).status).toBe("VOIDED");
    expect((await matchRow(ids[2])).ratingMultiplier).toBe(1); // now only the 2nd rated meeting
    const run = await db.eloRatingRun.findFirstOrThrow({
      where: { sessionId: fx.session.id, supersededAt: null },
    });
    expect(run.reason).toBe("VOID");
  });

  it("corrects the roster with an audited replay, keeping the consent record", async () => {
    fx = await eloEvent(6);
    const [a, b, c, d, e] = fx.players;
    const { matchId } = await playEloMatch(fx, [a, b], [c, d], "A");
    const before = await matchRow(matchId);
    await correct(fx, matchId, { sideA: [a.id, e.id], sideB: [c.id, d.id] }, "Falsche Person eingetragen");
    const after = await matchRow(matchId);
    expect(after.rosterHash).toBe(before.rosterHash);
    expect(after.consentAHash).toBe(before.consentAHash);
    expect(after.pairKey).not.toBe(before.pairKey);
    expect(await ratingOf(fx.session.id, e)).toBe(106);
    expect(await ratingOf(fx.session.id, b)).toBe(100);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "elo.match.correct", entityId: matchId },
    });
    expect((audit.after as { ownMatch: boolean }).ownMatch).toBe(false);
  });

  it("turns a rated match into a friendly (and back) only through a correction", async () => {
    fx = await eloEvent(4);
    const [a, b] = fx.players;
    const { matchId } = await playEloMatch(fx, [a], [b], "A");
    await correct(fx, matchId, { rated: false }, "War ein Freundschaftsspiel");
    expect(await db.eloPlayerRating.count()).toBe(0);
    const run = await db.eloRatingRun.findFirstOrThrow({
      where: { sessionId: fx.session.id, supersededAt: null },
    });
    expect(run.reason).toBe("RATED_CHANGED");
    await correct(fx, matchId, { rated: true }, "Doch gewertet");
    expect(await ratingOf(fx.session.id, a)).toBe(112);
  });

  it("is admin-only, version-checked and refuses empty corrections", async () => {
    fx = await eloEvent(4);
    const [a, b] = fx.players;
    const { matchId } = await playEloMatch(fx, [a], [b], "A");
    const m = await matchRow(matchId);
    const input = {
      matchId,
      expectedVersion: m.version,
      resultVersion: m.resultVersion,
      changes: { winnerSide: "B" as const },
      reason: "Falsch eingetragen",
      idempotencyKey: idemKey(),
    };
    expect(await errorCode(correctEloMatch(actorOf(fx.referee), input))).toBe("FORBIDDEN");
    expect(await errorCode(correctEloMatch(actorOf(fx.admin), { ...input, resultVersion: 0 }))).toBe(
      "STALE_VERSION",
    );
    expect(
      await errorCode(correctEloMatch(actorOf(fx.admin), { ...input, changes: { winnerSide: "A" } })),
    ).toBe("VALIDATION");
    expect(await errorCode(correctEloMatch(actorOf(fx.admin), { ...input, reason: "kurz" }))).toBe(
      "VALIDATION",
    );
  });

  it("serializes a correction and a concurrent confirmation without a partial replay", async () => {
    fx = await eloEvent(6);
    const [a, b, c, d] = fx.players;
    const first = await playEloMatch(fx, [a], [b], "A", { table: 0 });
    const running = await startedMatch(fx, [c], [d], { table: 1 });
    const m = await matchRow(running);
    const s = await submitEloResult(actorOf(c), {
      matchId: running,
      expectedVersion: m.version,
      winnerSide: "A",
      endType: "REGULAR",
      idempotencyKey: idemKey(),
    });
    const firstRow = await matchRow(first.matchId);
    const results = await Promise.allSettled([
      correctEloMatch(actorOf(fx.admin), {
        matchId: first.matchId,
        expectedVersion: firstRow.version,
        resultVersion: firstRow.resultVersion,
        changes: { winnerSide: "B" },
        reason: "Falsch eingetragen",
        idempotencyKey: idemKey(),
      }),
      confirmEloResult(actorOf(d), {
        matchId: running,
        resultVersion: s.resultVersion,
        idempotencyKey: idemKey(),
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await ratingOf(fx.session.id, b)).toBe(112);
    expect(await ratingOf(fx.session.id, c)).toBe(112);
  });
});

describe("rating parameters and session lifecycle", () => {
  it("changes K only through the audited recalculation once rated matches exist", async () => {
    fx = await eloEvent(4);
    const [a, b] = fx.players;
    const s0 = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    // Without rated matches a change needs no confirmation.
    const k30 = await updateEloParams(
      actorOf(fx.admin),
      {
        sessionId: s0.id,
        expectedConfigVersion: s0.configVersion,
        params: { ...DEFAULT_ELO_PARAMS, kFactor: 30 },
      },
      fx.opts,
    );
    expect(k30.changed).toBe(true);
    await playEloMatch(fx, [a], [b], "A");
    expect(await ratingOf(fx.session.id, a)).toBe(115);
    const s1 = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    const k32 = { ...DEFAULT_ELO_PARAMS, kFactor: 32 };
    expect(
      await errorCode(
        updateEloParams(
          actorOf(fx.admin),
          { sessionId: s1.id, expectedConfigVersion: s1.configVersion, params: k32 },
          fx.opts,
        ),
      ),
    ).toBe("CONFIRMATION_REQUIRED");
    await updateEloParams(
      actorOf(fx.admin),
      {
        sessionId: s1.id,
        expectedConfigVersion: s1.configVersion,
        params: k32,
        reason: "Mehr Bewegung",
        confirmText: RECALC_CONFIRM_TEXT,
      },
      fx.opts,
    );
    expect(await ratingOf(fx.session.id, a)).toBe(116);
    const run = await db.eloRatingRun.findFirstOrThrow({
      where: { sessionId: fx.session.id, supersededAt: null },
    });
    expect([run.reason, run.kFactor]).toEqual(["CONFIG_CHANGE", 32]);
    // Unchanged parameters are a no-op; invalid ones are refused.
    const s2 = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    expect(
      (
        await updateEloParams(
          actorOf(fx.admin),
          { sessionId: s2.id, expectedConfigVersion: s2.configVersion, params: k32 },
          fx.opts,
        )
      ).changed,
    ).toBe(false);
    expect(
      await errorCode(
        updateEloParams(
          actorOf(fx.admin),
          { sessionId: s2.id, expectedConfigVersion: s2.configVersion, params: { ...k32, kFactor: 0 } },
          fx.opts,
        ),
      ),
    ).toBe("VALIDATION");
  });

  it("closes with co-champions on an exact tie, reopens audited and opens a fresh session", async () => {
    fx = await eloEvent(6);
    const [a, b, c, d, e] = fx.players;
    // a and b always play together: identical ratings.
    await playEloMatch(fx, [a, b], [c, d], "A", { table: 0 });
    await playEloMatch(fx, [a, b], [d, e], "A", { table: 0 });
    await playEloMatch(fx, [a, b], [c, e], "A", { table: 0 });
    const open = await startedMatch(fx, [c], [d], { table: 1 });
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    const close = () =>
      closeEloSession(
        actorOf(fx!.admin),
        { sessionId: s.id, expectedConfigVersion: s.configVersion, confirmText: CLOSE_CONFIRM_TEXT },
        fx!.opts,
      );
    expect(await errorCode(close())).toBe("INVALID_STATE"); // a match is still running
    const m = await matchRow(open);
    await abandonEloMatch(
      actorOf(fx.referee),
      { matchId: open, expectedVersion: m.version, reason: "Aufräumen" },
      fx.opts,
    );
    expect(
      await errorCode(
        closeEloSession(
          actorOf(fx.admin),
          { sessionId: s.id, expectedConfigVersion: s.configVersion, confirmText: "ok" },
          fx.opts,
        ),
      ),
    ).toBe("CONFIRMATION_REQUIRED");
    const closed = await close();
    expect([...closed.championUserIds].sort()).toEqual([a.id, b.id].sort());
    const s2 = await db.eloSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(s2.status).toBe("CLOSED");
    // Reopen (audited) withdraws the title; a new session needs the old one closed.
    expect(await errorCode(openEloSession(actorOf(fx.admin), {}, fx.opts))).toBe("RESOLVED");
    const newest = await db.eloSession.findFirstOrThrow({ where: { tournamentId: fx.t.id, status: "OPEN" } });
    expect(
      await errorCode(
        reopenEloSession(
          actorOf(fx.admin),
          { sessionId: s.id, expectedConfigVersion: s2.configVersion, reason: "Fehler beim Schliessen" },
          fx.opts,
        ),
      ),
    ).toBe("INVALID_STATE");
    expect(await db.eloPlayerRating.count({ where: { sessionId: newest.id } })).toBe(0);
  });
});
