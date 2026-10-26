// A whole Elo evening through the real services (simulate-elo-event.ts), then the database is
// checked independently: every guarantee of the rating system must hold at the end.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { conservationError, replaySession } from "@/server/domain/elo/replay";
import { loadReplayEntries, paramsOfRun } from "@/server/services/elo-ratings";
import { simulateEloEvent } from "@/server/sim/simulate-elo-event";
import { makeTournament, makeUser } from "./factories";
import { actorOf } from "./match-fixtures";

describe("full Elo event", () => {
  it("plays 40+ matches on two tables and ends consistent, conserved and lock-free", async () => {
    const t = await makeTournament();
    const admin = actorOf(await makeUser({ role: "ADMIN", displayName: "Admin" }));
    const referee = actorOf(await makeUser({ role: "REFEREE", displayName: "Schiri" }));
    const players = [];
    for (let i = 1; i <= 24; i++) players.push(actorOf(await makeUser({ displayName: `Gast ${i}` })));

    const report = await simulateEloEvent({ seed: 7, tournamentId: t.id, admin, referee, players });

    // Workload
    expect(report.matches.completed).toBeGreaterThanOrEqual(40);
    expect(report.maxConcurrentRunning).toBe(2);
    expect(Object.keys(report.teamSizes)).toEqual(
      expect.arrayContaining(["1v1", "2v2", "1v4", "4v4", "3v4"]),
    );
    expect(report.matches.friendlies).toBeGreaterThan(0);
    expect(report.matches.repeatsReduced).toBeGreaterThan(0);
    expect(report.matches).toMatchObject({ cancelled: 1, voided: 1, abandoned: 1, disputesResolved: 1 });
    expect(report.idempotentReplays).toBe(1);

    // Guarantees
    expect(report.leftoverPlayerLocks).toBe(0);
    expect(report.leftoverLiveMatches).toBe(0);
    expect(report.verify.maxDeviation).toBe(0);
    expect(report.verify.mismatchedUserIds).toEqual([]);
    expect(Math.abs(report.ratingSum - report.expectedRatingSum)).toBeLessThan(1e-9);
    expect(report.recalculationDigestUnchanged).toBe(true);
    expect(report.runs).toBe(3); // initial, correction, manual recalculation
    expect(report.champions.length).toBeGreaterThanOrEqual(1);

    // Independent check: a fresh replay of the stored history equals the projection.
    const run = await db.eloRatingRun.findFirstOrThrow({
      where: { sessionId: report.sessionId, supersededAt: null },
    });
    const { state } = replaySession(await loadReplayEntries(db, report.sessionId), paramsOfRun(run));
    const stored = await db.eloPlayerRating.findMany({ where: { sessionId: report.sessionId } });
    for (const p of stored) expect(state.players.get(p.userId)?.rating).toBe(p.rating);
    expect(conservationError([...state.players.values()], run.initialRating)).toBeLessThan(1e-9);

    // Exactly one set of rating rows per effective match (no duplicates from the double confirm).
    const rows = await db.eloRatingChange.groupBy({
      by: ["matchId", "userId"],
      where: { runId: run.id },
      _count: true,
    });
    expect(rows.every((r) => r._count === 1)).toBe(true);

    // The competitive side was never touched.
    expect(await db.match.count({ where: { tournamentId: t.id } })).toBe(0);
  });
});
