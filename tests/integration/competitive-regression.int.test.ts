// Competitive Mode must work unchanged next to Elo Mode (spec §10, §11.6): after a
// COMPETITIVE → ELO → COMPETITIVE round trip with real Elo data, the full 19-match tournament
// still runs through the real services — draw and groups, result recording, tiebreak shootout,
// knockout advancement, fixed two-player teams, the countdown and the public snapshot.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { computeTimer } from "@/server/domain/timer";
import { ensureTournament } from "@/server/services/bootstrap";
import { buildPublicSnapshot, clearLiveSnapshotCache } from "@/server/services/live-snapshot";
import { setGameMode } from "@/server/services/game-mode";
import { simulateTournament } from "@/server/sim/simulate-tournament";
import { makeUser } from "./factories";
import { actorOf } from "./match-fixtures";
import { assertEloInvariants, playEloMatch, type EloFx } from "./elo-fixtures";

describe("competitive mode after an Elo round trip", () => {
  it("plays the complete tournament and leaves the Elo history untouched", async () => {
    clearLiveSnapshotCache();
    const tournamentId = await ensureTournament(db);
    const admin = await makeUser({ role: "ADMIN", displayName: "Admin" });
    const players = await Promise.all([1, 2, 3, 4].map((i) => makeUser({ displayName: `Gast ${i}` })));
    const opts = { tournamentId };

    // Elo apéro before the tournament: one session, two rated matches.
    await setGameMode(actorOf(admin), { mode: "ELO" }, opts);
    const session = await db.eloSession.findFirstOrThrow({ where: { tournamentId } });
    const tables = await db.gameTable.findMany({ where: { tournamentId }, orderBy: { number: "asc" } });
    const fx: EloFx = {
      t: await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } }),
      admin,
      referee: admin,
      players,
      session,
      tables,
      opts,
    };
    await playEloMatch(fx, [players[0], players[1]], [players[2], players[3]], "A");
    await playEloMatch(fx, [players[0]], [players[2]], "B");
    const eloBefore = await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } });
    await setGameMode(actorOf(admin), { mode: "COMPETITIVE" }, opts);

    const report = await simulateTournament({ seed: 7, tournamentId, demoPassword: "simulation-pass-123" });

    // Group stage, tiebreak shootout, knockout advancement and the champion.
    expect(report.matchesPlayed).toBe(19);
    expect(report.maxConcurrentInProgress).toBe(2);
    const kinds = report.events.map((e) => e.kind);
    for (const k of ["UNRESOLVED_TIE_BLOCKED", "RANKING_SHOOTOUT", "CHAMPION"]) expect(kinds).toContain(k);
    const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe("COMPLETED");
    expect(t.gameMode).toBe("COMPETITIVE");
    expect(t.championTeamId).toBe(report.championTeamId);
    const matches = await db.match.findMany({ where: { tournamentId } });
    expect(matches.filter((m) => m.status === "COMPLETED")).toHaveLength(19);
    expect(await db.activeTeamMatch.count()).toBe(0);
    // Fixed two-player teams: every active team still has exactly two members.
    const teams = await db.team.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { members: { where: { leftAt: null } } },
    });
    expect(teams).toHaveLength(12);
    expect(teams.every((x) => x.members.length === 2)).toBe(true);
    // The countdown still uses the configured 15 minutes.
    const final = matches.find((m) => m.code === "F")!;
    const timer = computeTimer(
      {
        startedAt: final.startedAt!.getTime(),
        pausedAt: null,
        endedAt: null,
        pausedDurationMs: 0,
        durationSec: t.matchDurationSec,
      },
      final.startedAt!.getTime() + 60_000,
    );
    expect(t.matchDurationSec).toBe(900);
    expect(timer.remainingMs).toBe(840_000);
    // Public snapshot: competitive shape plus the active mode.
    const snap = await buildPublicSnapshot(tournamentId);
    expect(snap.gameMode).toBe("COMPETITIVE");
    expect(snap.tournament.championTeamId).toBe(report.championTeamId);
    expect(snap.matches).toHaveLength(19);

    // Elo history is exactly as it was.
    expect(await db.eloPlayerRating.findMany({ orderBy: { userId: "asc" } })).toEqual(eloBefore);
    expect(await db.eloMatch.count({ where: { status: "COMPLETED" } })).toBe(2);
    await assertEloInvariants(session.id);
  }, 180_000);
});
