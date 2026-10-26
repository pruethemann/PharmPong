// Elo live snapshots (/api/elo/live, /api/elo/live/public): privacy, per-viewer permissions,
// the public gate, the fast path and the leaderboard data (spec §7, §8.8).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { LiveResponse } from "@/lib/live-types";
import type { EloAuthedSnapshot, EloPublicSnapshot } from "@/lib/elo-live-types";
import {
  buildEloAuthedSnapshot,
  buildEloPublicSnapshot,
  clearEloSnapshotCache,
  handleEloAuthedLive,
  handleEloPublicLive,
} from "@/server/services/elo-snapshot";
import { submitEloResult } from "@/server/services/elo-results";
import { setPublicDisplay } from "@/server/services/game-mode";
import { actorOf, idemKey } from "./match-fixtures";
import { draftMatch, eloEvent, matchRow, playEloMatch, startedMatch, type EloFx } from "./elo-fixtures";

beforeEach(() => clearEloSnapshotCache());

async function body<T>(res: Response): Promise<LiveResponse<T>> {
  return (await res.json()) as LiveResponse<T>;
}

function full<T>(r: LiveResponse<T>): { unchanged: false } & T {
  if (r.unchanged) throw new Error("expected a full snapshot");
  return r;
}

/** Four rated matches, one friendly, one live draft, one running and one pending match. */
async function busyEvening(fx: EloFx) {
  const [a, b, c, d, e, f] = fx.players;
  await playEloMatch(fx, [a, b], [c, d], "B"); // c, d win
  await playEloMatch(fx, [a, b], [c, d], "B"); // same pairing again
  await playEloMatch(fx, [e], [f], "A", { rated: false });
  await playEloMatch(fx, [c, d], [a, b], "A"); // third meeting: 50%
  const pending = await startedMatch(fx, [e], [f], { table: 1 });
  const m = await matchRow(pending);
  await submitEloResult(actorOf(e), {
    matchId: pending,
    expectedVersion: m.version,
    winnerSide: "A",
    endType: "REGULAR",
    idempotencyKey: idemKey(),
  });
  const draft = await draftMatch(fx, [a, b], [c, d], { table: 0, consent: false }); // would be the 4th meeting
  return { pending, draft: draft.matchId };
}

describe("Elo snapshot content", () => {
  it("shows tables, leaderboard, live, pending and recent matches with the repeat banner", async () => {
    const fx = await eloEvent(8);
    const [a, b, c, d, e] = fx.players;
    const { pending, draft } = await busyEvening(fx);
    const s = await buildEloPublicSnapshot(fx.t.id);
    expect(s.gameMode).toBe("ELO");
    expect(s.session).toMatchObject({
      status: "OPEN",
      params: { kFactor: 24, ratingScale: 100, runRevision: 1 },
    });
    expect(s.tables.map((t) => [t.number, t.state, t.matchId])).toEqual([
      [1, "RESERVED", draft],
      [2, "AVAILABLE", null],
    ]);
    expect(s.liveMatches.map((m) => m.id)).toEqual([draft]);
    expect(s.liveMatches[0].prospective).toEqual({ multiplier: 0, priorCount: 3 }); // unrated 4th meeting
    expect(s.pendingMatches.map((m) => [m.id, m.status, m.report?.side, m.report?.byName])).toEqual([
      [pending, "AWAITING_CONFIRMATION", "A", e.displayName],
    ]);
    expect(s.recentMatches.map((m) => m.result?.sequence)).toEqual([4, 3, 2, 1]);
    expect(s.recentMatches[0].result?.multiplier).toBe(0.5);
    expect(s.recentMatches[1].ratingChanges).toEqual([]); // the friendly
    expect(s.leaderboard[0]).toMatchObject({
      userId: c.id,
      rank: 1,
      gamesPlayed: 3,
      provisional: false,
      eligible: true,
    });
    expect(s.leaderboard.every((r) => r.ratingChange === r.rating - 100)).toBe(true);
    expect(s.stats).toMatchObject({ completed: 4, rated: 3, players: 4, eligible: 4 });
    // a, b, c and d each completed 3 matches and reached that count in the same match: userId decides.
    expect(s.achievements.mostActive?.value).toBe(3);
    expect(s.achievements.mostActive?.userIds).toEqual([[a, b, c, d].map((u) => u.id).sort()[0]]);
    expect(Object.values(s.pairCounts).sort()).toEqual([3]);
  });

  it("never contains e-mail addresses, and the player list only for signed-in users", async () => {
    const fx = await eloEvent(6);
    await busyEvening(fx);
    const pub = JSON.stringify(await buildEloPublicSnapshot(fx.t.id));
    const authed = await buildEloAuthedSnapshot(actorOf(fx.players[0]), fx.t.id);
    for (const u of await db.user.findMany()) {
      expect(pub).not.toContain(u.email);
      expect(JSON.stringify(authed)).not.toContain(u.email);
    }
    expect(pub).not.toContain('"roster"');
    expect(authed.roster.length).toBe(8); // 6 players + admin + referee, all active accounts
    expect(authed.roster.find((r) => r.userId === fx.players[0].id)?.busyMatchId).not.toBeNull();
  });

  it("carries the viewer's permissions and to-do list", async () => {
    const fx = await eloEvent(8);
    const [, , c, , , f] = fx.players;
    const { pending, draft } = await busyEvening(fx);
    const forC = await buildEloAuthedSnapshot(actorOf(c), fx.t.id);
    expect(forC.matchOps[draft].can.consent).toBe(true);
    expect(forC.me.todo).toEqual([{ matchId: draft, kind: "CONSENT" }]);
    expect(forC.me.liveMatchId).toBe(draft);
    expect(forC.me.rank).toBe(1);
    const forF = await buildEloAuthedSnapshot(actorOf(f), fx.t.id);
    expect(forF.matchOps[pending].can).toMatchObject({
      confirmResult: true,
      disputeResult: true,
      amendResult: false,
    });
    expect(forF.me.todo).toEqual([{ matchId: pending, kind: "CONFIRM_RESULT" }]);
    const forRef = await buildEloAuthedSnapshot(actorOf(fx.referee), fx.t.id);
    expect(forRef.staff).toEqual({ disputes: 0, pendingResults: 1, drafts: 1 });
    expect(forRef.matchOps[pending].can.staffFinalize).toBe(true);
    expect(forF.staff).toBeUndefined();
  });

  it("shows an expired draft's table as free", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    const { matchId } = await draftMatch(fx, [a], [b], { consent: false });
    await db.eloMatch.update({ where: { id: matchId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const s = await buildEloPublicSnapshot(fx.t.id);
    expect(s.tables[0].state).toBe("AVAILABLE");
    expect(s.liveMatches).toEqual([]);
    const authed = await buildEloAuthedSnapshot(actorOf(a), fx.t.id);
    expect(authed.roster.find((r) => r.userId === a.id)?.busyMatchId).toBeNull();
  });

  it("works before any session exists", async () => {
    const fx = await eloEvent(2);
    await db.eloRatingRun.deleteMany();
    await db.eloSession.deleteMany();
    const s = await buildEloPublicSnapshot(fx.t.id);
    expect(s.session).toBeNull();
    expect(s.tables.map((t) => t.state)).toEqual(["AVAILABLE", "AVAILABLE"]);
  });
});

describe("Elo live handlers", () => {
  it("gates the public endpoint on the public display and serves the fast path", async () => {
    const fx = await eloEvent(2);
    const get = (since?: number) =>
      handleEloPublicLive(
        new Request(`http://localhost/api/elo/live/public${since === undefined ? "" : `?since=${since}`}`),
        { tournamentId: fx.t.id },
      );
    expect((await get()).status).toBe(404);
    await setPublicDisplay(actorOf(fx.admin), { enabled: true }, fx.opts);
    const first = full(await body<EloPublicSnapshot>(await get()));
    expect(first.unchanged).toBe(false);
    const same = await body<EloPublicSnapshot>(await get(first.revision));
    expect(same).toEqual({ unchanged: true, revision: first.revision, serverNow: expect.any(Number) });
  });

  it("requires a signed-in user who changed the initial password", async () => {
    const fx = await eloEvent(2);
    const req = () => new Request("http://localhost/api/elo/live");
    expect((await handleEloAuthedLive(req(), null, { tournamentId: fx.t.id })).status).toBe(401);
    expect(
      (
        await handleEloAuthedLive(
          req(),
          { ...actorOf(fx.players[0]), mustChangePassword: true },
          { tournamentId: fx.t.id },
        )
      ).status,
    ).toBe(403);
    const ok = full(
      await body<EloAuthedSnapshot>(
        await handleEloAuthedLive(req(), actorOf(fx.players[0]), { tournamentId: fx.t.id }),
      ),
    );
    expect(ok.me.userId).toBe(fx.players[0].id);
  });
});
