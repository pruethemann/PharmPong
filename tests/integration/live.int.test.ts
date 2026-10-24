import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import { drawGroups } from "@/server/domain/draw";
import type { Role } from "@/generated/prisma/enums";
import {
  buildAuthedSnapshot,
  buildPublicSnapshot,
  clearLiveSnapshotCache,
  handleAuthedLive,
  handlePublicLive,
} from "@/server/services/live-snapshot";
import type { AuthedSnapshot, LiveResponse, PublicSnapshot } from "@/lib/live-types";
import { makeTeam, makeTournament, makeUser } from "./factories";

type Fixture = Awaited<ReturnType<typeof setupDrawnTournament>>;

/** 12 complete teams, drawn into groups (deterministic rng), group stage started. */
async function setupDrawnTournament() {
  const t = await makeTournament({ status: "GROUP_STAGE" });
  const teamIds: string[] = [];
  const memberIds: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = await makeUser({ email: `p${i}a@secret.example`, displayName: `Spieler ${i}A` });
    const b = await makeUser({ email: `p${i}b@secret.example`, displayName: `Spieler ${i}B` });
    const team = await makeTeam(t.id, [a.id, b.id], `Team ${String.fromCharCode(65 + i)}`);
    teamIds.push(team.id);
    memberIds.push(a.id);
  }
  const draw = drawGroups(teamIds, () => 0);
  const groupIdByName = new Map<string, string>();
  for (const [name, ids] of Object.entries(draw.groups)) {
    const g = await db.group.create({ data: { tournamentId: t.id, name } });
    groupIdByName.set(name, g.id);
    await db.groupAssignment.createMany({
      data: ids.map((teamId, i) => ({ groupId: g.id, teamId, position: i + 1 })),
    });
  }
  const idByCode = new Map<string, string>();
  // Create knockout matches from the final backwards so nextMatchId can be linked.
  for (const f of [...draw.fixtures].reverse()) {
    const m = await db.match.create({
      data: {
        tournamentId: t.id,
        code: f.code,
        stage: f.stage,
        round: f.round,
        orderIndex: f.orderIndex,
        groupId: f.group ? groupIdByName.get(f.group) : null,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        homeSource: f.homeSource,
        awaySource: f.awaySource,
        nextMatchId: f.nextCode ? idByCode.get(f.nextCode) : null,
        nextSlot: f.nextSlot,
        status: f.stage === "GROUP" ? "READY" : "PENDING",
      },
    });
    idByCode.set(f.code, m.id);
  }
  const tables = await db.gameTable.findMany({ where: { tournamentId: t.id }, orderBy: { number: "asc" } });
  return { tournament: t, teamIds, memberIds, idByCode, tables, draw };
}

async function bump(tournamentId: string) {
  await db.tournament.update({ where: { id: tournamentId }, data: { revision: { increment: 1 } } });
}

async function sessionRequest(url: string, role: Role | null, userId?: string) {
  const user = userId ? { id: userId } : await makeUser({ role: role ?? "PLAYER" });
  const { token } = await createSession(user.id, "vitest");
  return new Request(url, { headers: { cookie: `pp_session=${token}` } });
}

/** Mirrors getCurrentUser() for a Request (next/headers is unavailable outside a request scope). */
async function userOf(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const token = /(?:^|;\s*)pp_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) return null;
  return (await validateSessionToken(token))?.user ?? null;
}

async function authedGet(req: Request, tournamentId: string) {
  return handleAuthedLive(req, await userOf(req), { tournamentId });
}

async function body<T>(res: Response): Promise<LiveResponse<T>> {
  return (await res.json()) as LiveResponse<T>;
}

function full<T>(r: LiveResponse<T>): { unchanged: false } & T {
  if (r.unchanged) throw new Error("expected a full snapshot");
  return r;
}

async function assignAndStart(fx: Fixture, code: string, tableIdx: number, opts: { start?: boolean } = {}) {
  const now = new Date();
  const m = await db.match.update({
    where: { id: fx.idByCode.get(code)! },
    data: {
      status: opts.start ? "IN_PROGRESS" : "ASSIGNED",
      tableId: fx.tables[tableIdx].id,
      assignedAt: now,
      startedAt: opts.start ? now : null,
    },
  });
  await db.activeTeamMatch.createMany({
    data: [m.homeTeamId!, m.awayTeamId!].map((teamId) => ({
      teamId,
      matchId: m.id,
      tournamentId: fx.tournament.id,
    })),
  });
  await db.matchEvent.create({ data: { tournamentId: fx.tournament.id, matchId: m.id, type: "ASSIGNED" } });
  if (opts.start) {
    await db.matchEvent.create({ data: { tournamentId: fx.tournament.id, matchId: m.id, type: "STARTED" } });
  }
  await bump(fx.tournament.id);
  return m;
}

beforeEach(() => {
  clearLiveSnapshotCache();
});

describe("public snapshot", () => {
  it("contains no e-mails, invite codes or password hashes", async () => {
    const fx = await setupDrawnTournament();
    const snap = await buildPublicSnapshot(fx.tournament.id);
    const text = JSON.stringify(snap);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/INV\d{5}/);
    expect(text).not.toMatch(/inviteCode|passwordHash|email/i);
    for (const team of snap.teams) {
      expect(Object.keys(team).sort()).toEqual(["id", "logoUrl", "members", "motto", "name"]);
      expect(team.members).toHaveLength(2);
      expect(team.members[0]).toMatch(/^Spieler /);
    }
    expect(snap.teams).toHaveLength(12);
  });

  it("maps matches, labels, groups, tables and upNext", async () => {
    const fx = await setupDrawnTournament();
    await assignAndStart(fx, "A-1", 0, { start: true });
    await assignAndStart(fx, "B-1", 1);
    const snap = await buildPublicSnapshot(fx.tournament.id);

    expect(snap.matches).toHaveLength(19);
    const a1 = snap.matches.find((m) => m.code === "A-1")!;
    expect(a1.label).toBe("Gruppe A · Runde 1");
    expect(a1.status).toBe("IN_PROGRESS");
    expect(a1.tableNumber).toBe(1);
    expect(a1.timer).toMatchObject({ pausedAt: null, endedAt: null, pausedDurationMs: 0, durationSec: 900 });
    expect(a1.timer!.startedAt).toBeTypeOf("number");
    expect(a1.result).toBeNull();
    expect(snap.matches.find((m) => m.code === "B-1")!.timer).toBeNull();
    expect(snap.matches.find((m) => m.code === "QF2")!.label).toBe("Viertelfinal 2");
    expect(snap.matches.find((m) => m.code === "SF1")!.label).toBe("Halbfinal 1");
    const final = snap.matches.find((m) => m.code === "F")!;
    expect(final.label).toBe("Final");
    expect(final.homeSource).toBe("W:SF1");
    expect(snap.matches.find((m) => m.code === "QF1")!.nextCode).toBe("SF1");

    expect(snap.tables).toEqual([
      expect.objectContaining({ number: 1, state: "IN_PROGRESS", currentMatchId: fx.idByCode.get("A-1") }),
      expect.objectContaining({ number: 2, state: "RESERVED", currentMatchId: fx.idByCode.get("B-1") }),
    ]);

    expect(snap.groups.map((g) => g.name)).toEqual(["A", "B", "C", "D"]);
    expect(snap.groups[0].rows).toHaveLength(3);

    // READY matches in play order (stage, round, orderIndex), active ones excluded.
    expect(snap.upNext).toEqual(["C-1", "D-1", "A-2", "B-2"].map((c) => fx.idByCode.get(c)));
    expect(snap.recentEvents.map((e) => e.type)).toEqual([
      "MATCH_ASSIGNED",
      "MATCH_STARTED",
      "MATCH_ASSIGNED",
    ]);
  });

  it("announces semifinal/final advancement and the champion, but not quarterfinal advancement", async () => {
    const fx = await setupDrawnTournament();
    const team = fx.teamIds[0];
    const ev = (matchCode: string, type: string, payload: object) =>
      db.matchEvent.create({
        data: { tournamentId: fx.tournament.id, matchId: fx.idByCode.get(matchCode)!, type, payload },
      });
    await ev("A-3", "ADVANCED", { teamId: team, toCode: "QF1", slot: "HOME" });
    await ev("QF1", "ADVANCED", { teamId: team, toCode: "SF1", slot: "HOME" });
    await ev("SF1", "ADVANCED", { teamId: team, toCode: "F", slot: "HOME" });
    await ev("F", "CHAMPION", { teamId: team });
    await ev("F", "CONFIRMED", {});
    const snap = await buildPublicSnapshot(fx.tournament.id);
    expect(snap.recentEvents.map((e) => [e.type, e.teamId, e.matchId])).toEqual([
      ["ADVANCED_SEMIFINAL", team, fx.idByCode.get("SF1")],
      ["ADVANCED_FINAL", team, fx.idByCode.get("F")],
      ["CHAMPION", team, fx.idByCode.get("F")],
    ]);
  });

  it("standings reflect a confirmed result (and only confirmed results are exposed)", async () => {
    const fx = await setupDrawnTournament();
    const id = fx.idByCode.get("A-1")!;
    const m = await db.match.findUniqueOrThrow({ where: { id } });
    // A proposal (not yet confirmed) must not count.
    await db.match.update({
      where: { id },
      data: {
        status: "AWAITING_CONFIRMATION",
        tableId: fx.tables[0].id,
        winnerTeamId: m.homeTeamId,
        homeCupsRemaining: 4,
        awayCupsRemaining: 0,
        endType: "REGULAR",
      },
    });
    await bump(fx.tournament.id);
    let snap = await buildPublicSnapshot(fx.tournament.id);
    expect(snap.matches.find((x) => x.id === id)!.result).toBeNull();
    expect(snap.groups[0].rows.every((r) => r.played === 0)).toBe(true);

    await db.match.update({ where: { id }, data: { status: "COMPLETED", confirmedAt: new Date() } });
    await bump(fx.tournament.id);
    snap = await buildPublicSnapshot(fx.tournament.id);
    expect(snap.matches.find((x) => x.id === id)!.result).toEqual({
      winnerTeamId: m.homeTeamId,
      homeCupsRemaining: 4,
      awayCupsRemaining: 0,
      endType: "REGULAR",
    });
    const groupA = snap.groups.find((g) => g.name === "A")!;
    const winnerRow = groupA.rows.find((r) => r.teamId === m.homeTeamId)!;
    expect(winnerRow).toMatchObject({ played: 1, wins: 1, losses: 0 });
    expect(groupA.rows[0].teamId).toBe(m.homeTeamId);
    expect(groupA.rows.find((r) => r.teamId === m.awayTeamId)).toMatchObject({ played: 1, losses: 1 });
  });

  it("is consistent with the tournament revision and memoized per revision", async () => {
    const fx = await setupDrawnTournament();
    await bump(fx.tournament.id);
    await bump(fx.tournament.id);
    const t = await db.tournament.findUniqueOrThrow({ where: { id: fx.tournament.id } });
    const first = await buildPublicSnapshot(fx.tournament.id);
    expect(first.revision).toBe(t.revision);
    expect(first.tournament.id).toBe(t.id);

    await new Promise((r) => setTimeout(r, 15));
    const second = await buildPublicSnapshot(fx.tournament.id);
    expect(second.matches).toBe(first.matches); // cache hit
    expect(second.serverNow).toBeGreaterThan(first.serverNow); // refreshed

    await db.tournament.update({ where: { id: t.id }, data: { name: "Neu", revision: { increment: 1 } } });
    const third = await buildPublicSnapshot(fx.tournament.id);
    expect(third.revision).toBe(t.revision + 1);
    expect(third.tournament.name).toBe("Neu");
  });
});

describe("GET /api/live/public", () => {
  it("returns 404 when public display is disabled, 200 when enabled", async () => {
    const fx = await setupDrawnTournament();
    const url = "http://localhost/api/live/public";
    const off = await handlePublicLive(new Request(url), { tournamentId: fx.tournament.id });
    expect(off.status).toBe(404);
    expect(off.headers.get("Cache-Control")).toBe("no-store");

    await db.tournament.update({ where: { id: fx.tournament.id }, data: { publicDisplayEnabled: true } });
    const on = await handlePublicLive(new Request(url), { tournamentId: fx.tournament.id });
    expect(on.status).toBe(200);
    expect(on.headers.get("Cache-Control")).toBe("no-store");
    const snap = full(await body<PublicSnapshot>(on));
    expect(snap.unchanged).toBe(false);
    expect(snap.tournament.publicDisplayEnabled).toBe(true);
    expect(JSON.stringify(snap)).not.toContain("@");
  });

  it("returns 404 without a tournament", async () => {
    const res = await handlePublicLive(new Request("http://localhost/api/live/public"));
    expect(res.status).toBe(404);
  });

  it("answers {unchanged} when since equals the revision, a full snapshot otherwise", async () => {
    const fx = await setupDrawnTournament();
    const t = await db.tournament.update({
      where: { id: fx.tournament.id },
      data: { publicDisplayEnabled: true, revision: 5 },
    });
    const get = (since: string) =>
      handlePublicLive(new Request(`http://localhost/api/live/public?since=${since}`), {
        tournamentId: t.id,
      });

    const same = await body<PublicSnapshot>(await get("5"));
    expect(same).toEqual({ unchanged: true, revision: 5, serverNow: expect.any(Number) });

    const older = full(await body<PublicSnapshot>(await get("4")));
    expect(older.unchanged).toBe(false);
    expect(older.revision).toBe(5);
    expect(older.matches).toHaveLength(19);

    const garbage = full(await body<PublicSnapshot>(await get("abc")));
    expect(garbage.revision).toBe(5);
  });
});

describe("GET /api/live (authenticated)", () => {
  it("returns 401 without a session", async () => {
    const fx = await setupDrawnTournament();
    const res = await authedGet(new Request("http://localhost/api/live"), fx.tournament.id);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHENTICATED" });
    const bad = await authedGet(
      new Request("http://localhost/api/live", { headers: { cookie: "pp_session=nope" } }),
      fx.tournament.id,
    );
    expect(bad.status).toBe(401);
  });

  it("gives players me/myNextMatchId but no matchOps or admin extras", async () => {
    const fx = await setupDrawnTournament();
    const req = await sessionRequest("http://localhost/api/live", null, fx.memberIds[0]);
    const res = await authedGet(req, fx.tournament.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const snap = full(await body<AuthedSnapshot>(res));
    expect(snap.me).toMatchObject({ userId: fx.memberIds[0], role: "PLAYER", teamId: fx.teamIds[0] });
    expect(snap).not.toHaveProperty("matchOps");
    expect(snap).not.toHaveProperty("admin");
    const mine = snap.matches.find((m) => m.id === snap.myNextMatchId)!;
    expect([mine.homeTeamId, mine.awayTeamId]).toContain(fx.teamIds[0]);
    const firstOfTeam = snap.matches
      .filter((m) => m.homeTeamId === fx.teamIds[0] || m.awayTeamId === fx.teamIds[0])
      .sort((a, b) => a.orderIndex - b.orderIndex)[0];
    expect(mine.id).toBe(firstOfTeam.id);

    // Fast path for authed clients too.
    const again = await authedGet(
      new Request(`http://localhost/api/live?since=${snap.revision}`, { headers: req.headers }),
      fx.tournament.id,
    );
    expect(await again.json()).toEqual({
      unchanged: true,
      revision: snap.revision,
      serverNow: expect.any(Number),
    });
  });

  it("gives referees matchOps (proposal, open issue) but no admin extras", async () => {
    const fx = await setupDrawnTournament();
    const m = await assignAndStart(fx, "A-1", 0, { start: true });
    const proposedAt = new Date();
    await db.match.update({
      where: { id: m.id },
      data: {
        status: "AWAITING_CONFIRMATION",
        endedAt: proposedAt,
        winnerTeamId: m.awayTeamId,
        homeCupsRemaining: 0,
        awayCupsRemaining: 3,
        endType: "REGULAR",
        proposedAt,
        proposedById: fx.memberIds[1],
        resultRevision: 1,
        version: 3,
      },
    });
    const issue = (matchId: string, type: string, payload: object) =>
      db.matchEvent.create({ data: { tournamentId: fx.tournament.id, matchId, type, payload } });
    await issue(m.id, "ISSUE_REPORTED", { text: "Becher umgefallen" });
    const b1 = fx.idByCode.get("B-1")!;
    await issue(b1, "ISSUE_REPORTED", { text: "alt" });
    await new Promise((r) => setTimeout(r, 5));
    await issue(b1, "ISSUE_RESOLVED", { note: "ok" });
    await bump(fx.tournament.id);

    const req = await sessionRequest("http://localhost/api/live", "REFEREE");
    const snap = full(await body<AuthedSnapshot>(await authedGet(req, fx.tournament.id)));
    expect(snap.me.role).toBe("REFEREE");
    expect(snap.me.teamId).toBeNull();
    expect(snap.myNextMatchId).toBeNull();
    expect(snap).not.toHaveProperty("admin");
    expect(Object.keys(snap.matchOps!)).toHaveLength(19);
    expect(snap.matchOps![m.id]).toEqual({
      version: 3,
      resultRevision: 1,
      proposal: {
        winnerTeamId: m.awayTeamId,
        homeCupsRemaining: 0,
        awayCupsRemaining: 3,
        endType: "REGULAR",
        proposedById: fx.memberIds[1],
        proposedAt: proposedAt.getTime(),
      },
      openIssue: "Becher umgefallen",
    });
    expect(snap.matchOps![b1]).toMatchObject({ proposal: null, openIssue: null });
    // Proposed results are not public results.
    expect(snap.matches.find((x) => x.id === m.id)!.result).toBeNull();
  });

  it("gives admins suggestions, unresolved ties and pending confirmations", async () => {
    const fx = await setupDrawnTournament();
    const m = await assignAndStart(fx, "A-1", 0, { start: true });
    await db.match.update({ where: { id: m.id }, data: { status: "AWAITING_CONFIRMATION" } });
    await bump(fx.tournament.id);

    const req = await sessionRequest("http://localhost/api/live", "ADMIN");
    const snap = full(await body<AuthedSnapshot>(await authedGet(req, fx.tournament.id)));
    expect(snap.matchOps).toBeDefined();
    expect(snap.admin).toEqual({
      suggestions: [{ tableId: fx.tables[1].id, matchId: fx.idByCode.get("B-1") }],
      unresolvedTies: [],
      pendingConfirmations: 1,
    });

    await db.tournament.update({
      where: { id: fx.tournament.id },
      data: { isPaused: true, revision: { increment: 1 } },
    });
    const paused = await buildAuthedSnapshot(
      { id: "x", displayName: "Admin", role: "ADMIN" },
      fx.tournament.id,
    );
    expect(paused.admin!.suggestions).toEqual([]);
    expect(paused.tournament.isPaused).toBe(true);
  });

  it("reports an unresolved three-way tie to admins", async () => {
    const fx = await setupDrawnTournament();
    // Group A: everyone beats one, loses one, with identical cups → unresolved tie.
    for (const code of ["A-1", "A-2", "A-3"]) {
      const m = await db.match.findUniqueOrThrow({ where: { id: fx.idByCode.get(code)! } });
      await db.match.update({
        where: { id: m.id },
        data: {
          status: "COMPLETED",
          confirmedAt: new Date(),
          winnerTeamId: m.homeTeamId,
          homeCupsRemaining: 5,
          awayCupsRemaining: 0,
          endType: "REGULAR",
        },
      });
    }
    await bump(fx.tournament.id);
    const snap = await buildAuthedSnapshot(
      { id: "x", displayName: "Admin", role: "ADMIN" },
      fx.tournament.id,
    );
    const groupA = snap.groups.find((g) => g.name === "A")!;
    expect(groupA.unresolvedTie).toBe(true);
    expect(groupA.rows.every((r) => !r.qualified)).toBe(true);
    expect(snap.admin!.unresolvedTies).toHaveLength(1);
    expect(snap.admin!.unresolvedTies[0]).toMatchObject({ group: "A", positions: [1, 2, 3] });
    expect([...snap.admin!.unresolvedTies[0].teamIds].sort()).toEqual([...fx.draw.groups.A].sort());
  });
});
