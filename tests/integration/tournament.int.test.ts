import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import type { TournamentStatus } from "@/generated/prisma/enums";
import {
  cancelTournament,
  CANCEL_CONFIRM_TEXT,
  generateDraw,
  getTournamentOverview,
  lockRegistration,
  openRegistration,
  pauseTournament,
  reopenRegistration,
  resetDraw,
  RESET_DRAW_CONFIRM_TEXT,
  resumeTournament,
  startGroupStage,
  startKnockout,
  updateSettings,
} from "@/server/services/tournament";
import { recordRankingShootout, voidRankingShootout } from "@/server/services/tiebreaks";
import { renameTable, setTableDisabled } from "@/server/services/tables";
import { createDemoParticipants, DEMO_REFEREE_EMAIL, DEMO_TEAMS, seedDemo } from "@/server/sim/demo-data";
import { makeTeam, makeTournament, makeUser } from "./factories";

type U = Awaited<ReturnType<typeof makeUser>>;
const actor = (u: U): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
  return "RESOLVED";
}

async function makeAdmin() {
  return actor(await makeUser({ role: "ADMIN" }));
}

async function tournamentIn(status: TournamentStatus) {
  const t = await makeTournament();
  await db.tournament.update({ where: { id: t.id }, data: { status } });
  return t;
}

async function addCompleteTeams(tournamentId: string, n: number) {
  const teams = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [await makeUser(), await makeUser()];
    teams.push(await makeTeam(tournamentId, [a.id, b.id]));
  }
  return teams;
}

/** Tournament in REGISTRATION_LOCKED with 12 complete teams. */
async function lockedWith12() {
  const t = await makeTournament({ status: "REGISTRATION_LOCKED" });
  const teams = await addCompleteTeams(t.id, 12);
  return { t, teams, opts: { tournamentId: t.id } };
}

async function revision(id: string) {
  return (await db.tournament.findUniqueOrThrow({ where: { id } })).revision;
}

const ALL: TournamentStatus[] = [
  "DRAFT",
  "REGISTRATION_OPEN",
  "REGISTRATION_LOCKED",
  "GROUP_STAGE",
  "KNOCKOUT_STAGE",
  "COMPLETED",
  "CANCELLED",
];

describe("lifecycle transitions", () => {
  it.each(ALL)("openRegistration from %s", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    const r = await code(openRegistration(admin, { tournamentId: t.id }));
    if (from === "DRAFT") {
      expect(r).toBe("RESOLVED");
      expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
        "REGISTRATION_OPEN",
      );
      const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tournament.open_registration" } });
      expect(audit.before).toEqual({ status: "DRAFT" });
    } else {
      expect(r).toBe("INVALID_TRANSITION");
    }
  });

  it.each(ALL)("lockRegistration from %s", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    const r = await code(lockRegistration(admin, { tournamentId: t.id }));
    if (from === "REGISTRATION_OPEN") {
      expect(r).toBe("RESOLVED");
      const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.status).toBe("REGISTRATION_LOCKED");
      expect(after.rosterLockedAt).toBeInstanceOf(Date);
    } else {
      expect(r).toBe("INVALID_TRANSITION");
    }
  });

  it.each(ALL)("reopenRegistration from %s (no draw)", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    await db.tournament.update({ where: { id: t.id }, data: { rosterLockedAt: new Date() } });
    const r = await code(reopenRegistration(admin, { tournamentId: t.id }));
    if (from === "REGISTRATION_LOCKED") {
      expect(r).toBe("RESOLVED");
      const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.status).toBe("REGISTRATION_OPEN");
      expect(after.rosterLockedAt).toBeNull();
    } else {
      expect(r).toBe("INVALID_TRANSITION");
    }
  });

  it("reopenRegistration is refused once a draw exists", async () => {
    const admin = await makeAdmin();
    const { opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    expect(await code(reopenRegistration(admin, opts))).toBe("INVALID_STATE");
  });

  it.each(ALL)("startGroupStage from %s without draw", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    const r = await code(startGroupStage(admin, { tournamentId: t.id }));
    expect(r).toBe(from === "REGISTRATION_LOCKED" ? "INVALID_STATE" : "INVALID_TRANSITION");
  });

  it.each(ALL.filter((s) => s !== "GROUP_STAGE"))("startKnockout from %s", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    expect(await code(startKnockout(admin, { tournamentId: t.id }))).toBe("INVALID_TRANSITION");
  });

  it.each(ALL)("cancelTournament from %s", async (from) => {
    const admin = await makeAdmin();
    const t = await tournamentIn(from);
    const r = await code(
      cancelTournament(
        admin,
        { reason: "Feueralarm", confirmText: CANCEL_CONFIRM_TEXT },
        { tournamentId: t.id },
      ),
    );
    if (from === "COMPLETED" || from === "CANCELLED") {
      expect(r).toBe("INVALID_TRANSITION");
    } else {
      expect(r).toBe("RESOLVED");
      expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CANCELLED");
    }
  });

  it("cancelTournament requires the typed confirmation and a reason", async () => {
    const admin = await makeAdmin();
    const t = await tournamentIn("REGISTRATION_OPEN");
    const opts = { tournamentId: t.id };
    expect(
      await code(cancelTournament(admin, { reason: "Feueralarm", confirmText: "abbrechen" }, opts)),
    ).toBe("CONFIRMATION_REQUIRED");
    expect(await code(cancelTournament(admin, { reason: " ", confirmText: CANCEL_CONFIRM_TEXT }, opts))).toBe(
      "VALIDATION",
    );
  });

  it("cancelTournament cancels undecided matches and frees active team locks", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    await startGroupStage(admin, opts);
    const [m1, m2] = await db.match.findMany({
      where: { tournamentId: t.id, stage: "GROUP" },
      orderBy: { orderIndex: "asc" },
    });
    const table = await db.gameTable.findFirstOrThrow({ where: { tournamentId: t.id, number: 1 } });
    await db.match.update({ where: { id: m1.id }, data: { status: "ASSIGNED", tableId: table.id } });
    await db.activeTeamMatch.createMany({
      data: [
        { teamId: m1.homeTeamId!, matchId: m1.id, tournamentId: t.id },
        { teamId: m1.awayTeamId!, matchId: m1.id, tournamentId: t.id },
      ],
    });
    await db.match.update({
      where: { id: m2.id },
      data: {
        status: "COMPLETED",
        winnerTeamId: m2.homeTeamId,
        homeCupsRemaining: 2,
        awayCupsRemaining: 0,
        endType: "REGULAR",
        confirmedAt: new Date(),
      },
    });
    const r = await cancelTournament(
      admin,
      { reason: "Stromausfall", confirmText: CANCEL_CONFIRM_TEXT },
      opts,
    );
    expect(r.cancelledMatches).toBe(18);
    const statuses = await db.match.groupBy({ by: ["status"], where: { tournamentId: t.id }, _count: true });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count]))).toEqual({
      CANCELLED: 18,
      COMPLETED: 1,
    });
    expect(await db.activeTeamMatch.count()).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tournament.cancel" } });
    expect(audit.reason).toBe("Stromausfall");
  });
});

describe("overview & settings", () => {
  it("counts players, complete and incomplete teams", async () => {
    const t = await makeTournament({ status: "REGISTRATION_OPEN" });
    await addCompleteTeams(t.id, 3);
    const solo = await makeUser();
    await makeTeam(t.id, [solo.id]);
    const o = await getTournamentOverview(t.id);
    expect(o).toMatchObject({
      status: "REGISTRATION_OPEN",
      counts: {
        players: 7,
        teams: 4,
        completeTeams: 3,
        incompleteTeams: 1,
        eligibleTeams: 3,
        requiredTeams: 12,
      },
    });
    expect((await getTournamentOverview())?.id).toBe(t.id);
  });

  it("updates settings with validation and audit", async () => {
    const admin = await makeAdmin();
    const t = await makeTournament();
    const opts = { tournamentId: t.id };
    const r = await updateSettings(
      admin,
      {
        name: "  PharmaPong   2026 ",
        matchDurationSec: 600,
        bombRuleEnabled: true,
        publicDisplayEnabled: true,
      },
      opts,
    );
    expect(r).toEqual({
      name: "PharmaPong 2026",
      matchDurationSec: 600,
      bombRuleEnabled: true,
      publicDisplayEnabled: true,
    });
    expect(await code(updateSettings(admin, { matchDurationSec: 299 }, opts))).toBe("VALIDATION");
    expect(await code(updateSettings(admin, { matchDurationSec: 3601 }, opts))).toBe("VALIDATION");
    expect(await code(updateSettings(admin, { name: "x" }, opts))).toBe("VALIDATION");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tournament.update_settings" } });
    expect(audit.before).toMatchObject({ matchDurationSec: 900, bombRuleEnabled: false });
  });

  it("refuses a duration change while a match is in progress", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    await startGroupStage(admin, opts);
    const m = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, code: "A-1" } });
    const table = await db.gameTable.findFirstOrThrow({ where: { tournamentId: t.id } });
    await db.match.update({
      where: { id: m.id },
      data: { status: "IN_PROGRESS", tableId: table.id, startedAt: new Date() },
    });
    expect(await code(updateSettings(admin, { matchDurationSec: 1200 }, opts))).toBe("INVALID_STATE");
    // Other settings stay editable.
    await updateSettings(admin, { bombRuleEnabled: true }, opts);
  });
});

describe("generateDraw", () => {
  it("creates 4 groups × 3 and 19 linked fixtures", async () => {
    const admin = await makeAdmin();
    const { t, teams, opts } = await lockedWith12();
    const r = await generateDraw(admin, {}, opts);
    expect(r.redraw).toBe(false);
    expect(r.groups.map((g) => g.name)).toEqual(["A", "B", "C", "D"]);
    expect(
      r.groups.every((g) => g.teams.length === 3 && g.teams.every((x) => x.name.startsWith("Team "))),
    ).toBe(true);

    const groups = await db.group.findMany({ where: { tournamentId: t.id }, include: { assignments: true } });
    expect(groups).toHaveLength(4);
    const assigned = groups.flatMap((g) => g.assignments.map((a) => a.teamId));
    expect(assigned.sort()).toEqual(teams.map((x) => x.id).sort());
    for (const g of groups) expect(g.assignments.map((a) => a.position).sort()).toEqual([1, 2, 3]);

    const matches = await db.match.findMany({
      where: { tournamentId: t.id },
      orderBy: { orderIndex: "asc" },
    });
    expect(matches).toHaveLength(19);
    expect(matches.filter((m) => m.stage === "GROUP")).toHaveLength(12);
    expect(matches.filter((m) => m.stage === "KNOCKOUT")).toHaveLength(7);
    expect(matches.map((m) => m.orderIndex)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(new Set(matches.map((m) => m.code)).size).toBe(19);
    expect(matches.every((m) => m.status === "PENDING")).toBe(true);

    // Each pair within a group plays exactly once.
    for (const g of groups) {
      const gm = matches.filter((m) => m.groupId === g.id);
      expect(gm).toHaveLength(3);
      const pairs = gm.map((m) => [m.homeTeamId!, m.awayTeamId!].sort().join("|"));
      expect(new Set(pairs).size).toBe(3);
      for (const m of gm) {
        const ids = g.assignments.map((a) => a.teamId);
        expect(ids).toContain(m.homeTeamId);
        expect(ids).toContain(m.awayTeamId);
      }
    }

    const byCode = new Map(matches.map((m) => [m.code, m]));
    const link = (from: string) => {
      const m = byCode.get(from)!;
      return [matches.find((x) => x.id === m.nextMatchId)?.code, m.nextSlot];
    };
    expect(link("QF1")).toEqual(["SF1", "HOME"]);
    expect(link("QF3")).toEqual(["SF1", "AWAY"]);
    expect(link("QF2")).toEqual(["SF2", "HOME"]);
    expect(link("QF4")).toEqual(["SF2", "AWAY"]);
    expect(link("SF1")).toEqual(["F", "HOME"]);
    expect(link("SF2")).toEqual(["F", "AWAY"]);
    expect(byCode.get("F")!.nextMatchId).toBeNull();
    expect(byCode.get("QF1")).toMatchObject({ homeSource: "A1", awaySource: "B2", homeTeamId: null });
    expect(byCode.get("QF4")).toMatchObject({ homeSource: "D1", awaySource: "C2" });

    const tour = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(tour.drawGeneratedAt).toBeInstanceOf(Date);
    expect(await db.auditLog.count({ where: { action: "tournament.draw" } })).toBe(1);
  });

  it("is deterministic for a given rng", async () => {
    const admin = await makeAdmin();
    const { opts } = await lockedWith12();
    const zero = () => 0;
    const a = await generateDraw(admin, { rng: zero }, opts);
    const b = await generateDraw(admin, { rng: zero }, opts);
    expect(b.redraw).toBe(true);
    expect(b.groups).toEqual(a.groups);
  });

  it.each([11, 13])("refuses %i complete teams with WRONG_TEAM_COUNT", async (n) => {
    const admin = await makeAdmin();
    const t = await makeTournament({ status: "REGISTRATION_LOCKED" });
    await addCompleteTeams(t.id, n);
    expect(await code(generateDraw(admin, {}, { tournamentId: t.id }))).toBe("WRONG_TEAM_COUNT");
    expect(await db.match.count()).toBe(0);
  });

  it("refuses while an active team is incomplete and names it", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    const solo = await makeUser();
    await makeTeam(t.id, [solo.id], "Einsame Elektronen");
    const err = await generateDraw(admin, {}, opts).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toContain("Einsame Elektronen");
  });

  it("ignores dissolved teams and members who left", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    const gone = await makeTeam(t.id, [(await makeUser()).id]);
    await db.team.update({ where: { id: gone.id }, data: { status: "DISSOLVED" } });
    expect(await code(generateDraw(admin, {}, opts))).toBe("RESOLVED");
    // A team whose member left is incomplete.
    const t0 = await db.teamMember.findFirstOrThrow({
      where: { tournamentId: t.id, team: { status: "ACTIVE" } },
    });
    await db.teamMember.update({ where: { id: t0.id }, data: { leftAt: new Date() } });
    expect(await code(generateDraw(admin, {}, opts))).toBe("VALIDATION");
  });

  it("is only allowed in REGISTRATION_LOCKED", async () => {
    const admin = await makeAdmin();
    for (const status of ["DRAFT", "REGISTRATION_OPEN"] as const) {
      await db.tournament.deleteMany();
      const t = await makeTournament({ status });
      await addCompleteTeams(t.id, 12);
      expect(await code(generateDraw(admin, {}, { tournamentId: t.id }))).toBe("INVALID_STATE");
    }
  });

  it("redraw before the group stage replaces the fixtures and audits the old groups", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    const oldIds = (await db.match.findMany({ where: { tournamentId: t.id } })).map((m) => m.id);
    const r = await generateDraw(admin, {}, opts);
    expect(r.redraw).toBe(true);
    const now = await db.match.findMany({ where: { tournamentId: t.id } });
    expect(now).toHaveLength(19);
    expect(now.some((m) => oldIds.includes(m.id))).toBe(false);
    expect(await db.group.count()).toBe(4);
    expect(await db.groupAssignment.count()).toBe(12);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tournament.redraw" } });
    expect((audit.before as { groups: unknown[] }).groups).toHaveLength(4);
  });

  it("after startGroupStage only resetDraw can replace the draw", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    const started = await startGroupStage(admin, opts);
    expect(started.readyMatches).toBe(12);
    const ms = await db.match.findMany({ where: { tournamentId: t.id } });
    expect(ms.filter((m) => m.status === "READY").every((m) => m.stage === "GROUP")).toBe(true);
    expect(ms.filter((m) => m.status === "READY")).toHaveLength(12);
    expect(ms.filter((m) => m.stage === "KNOCKOUT").every((m) => m.status === "PENDING")).toBe(true);

    expect(["INVALID_TRANSITION", "INVALID_STATE"]).toContain(await code(generateDraw(admin, {}, opts)));

    // Play one match so the snapshot has a result.
    const a1 = ms.find((m) => m.code === "A-1")!;
    await db.match.update({
      where: { id: a1.id },
      data: {
        status: "COMPLETED",
        winnerTeamId: a1.homeTeamId,
        homeCupsRemaining: 4,
        awayCupsRemaining: 0,
        endType: "REGULAR",
        confirmedAt: new Date(),
      },
    });
    await db.matchEvent.create({ data: { tournamentId: t.id, matchId: a1.id, type: "CONFIRMED" } });

    expect(
      await code(resetDraw(admin, { reason: "Falsche Teams ausgelost", confirmText: "zurücksetzen" }, opts)),
    ).toBe("CONFIRMATION_REQUIRED");
    expect(await code(resetDraw(admin, { reason: "kurz", confirmText: RESET_DRAW_CONFIRM_TEXT }, opts))).toBe(
      "VALIDATION",
    );

    const r = await resetDraw(
      admin,
      { reason: "Falsche Teams ausgelost", confirmText: RESET_DRAW_CONFIRM_TEXT },
      opts,
    );
    expect(r).toEqual({ status: "REGISTRATION_LOCKED", archivedMatches: 19 });
    const tour = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(tour).toMatchObject({
      status: "REGISTRATION_LOCKED",
      drawGeneratedAt: null,
      isPaused: false,
      championTeamId: null,
    });
    expect(await db.match.count()).toBe(0);
    expect(await db.group.count()).toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tournament.reset_draw" } });
    expect(audit.reason).toBe("Falsche Teams ausgelost");
    const before = audit.before as {
      groups: { assignments: unknown[] }[];
      matches: { id: string; code: string; winnerTeamId: string | null; events: { type: string }[] }[];
    };
    expect(before.groups).toHaveLength(4);
    expect(before.matches).toHaveLength(19);
    const snapA1 = before.matches.find((m) => m.code === "A-1")!;
    expect(snapA1.id).toBe(a1.id);
    expect(snapA1.winnerTeamId).toBe(a1.homeTeamId);
    expect(snapA1.events.map((e) => e.type)).toEqual(["CONFIRMED"]);

    // A fresh draw is possible again.
    expect((await generateDraw(admin, {}, opts)).redraw).toBe(false);
  });

  it("resetDraw is refused without a draw or outside the play phases", async () => {
    const admin = await makeAdmin();
    const { opts } = await lockedWith12();
    const input = { reason: "Neu auslosen bitte", confirmText: RESET_DRAW_CONFIRM_TEXT };
    expect(await code(resetDraw(admin, input, opts))).toBe("INVALID_STATE");
    await db.tournament.update({ where: { id: opts.tournamentId }, data: { status: "REGISTRATION_OPEN" } });
    expect(await code(resetDraw(admin, input, opts))).toBe("INVALID_TRANSITION");
  });

  it("startGroupStage refuses when a drawn team became incomplete", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    const member = await db.teamMember.findFirstOrThrow({ where: { tournamentId: t.id } });
    await db.teamMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
    expect(await code(startGroupStage(admin, opts))).toBe("VALIDATION");
  });
});

describe("tournament pause", () => {
  it("pauses only running matches and resumes exactly those", async () => {
    const admin = await makeAdmin();
    const { t, opts } = await lockedWith12();
    await generateDraw(admin, {}, opts);
    expect(await code(pauseTournament(admin, {}, opts))).toBe("INVALID_STATE");
    await startGroupStage(admin, opts);
    const [m1, m2, m3] = await db.match.findMany({
      where: { tournamentId: t.id },
      orderBy: { orderIndex: "asc" },
    });
    const [t1, t2] = await db.gameTable.findMany({
      where: { tournamentId: t.id },
      orderBy: { number: "asc" },
    });
    const earlier = new Date(Date.now() - 60_000);
    await db.match.update({
      where: { id: m1.id },
      data: { status: "IN_PROGRESS", tableId: t1.id, startedAt: new Date(Date.now() - 120_000) },
    });
    await db.match.update({
      where: { id: m2.id },
      data: {
        status: "IN_PROGRESS",
        tableId: t2.id,
        startedAt: new Date(Date.now() - 120_000),
        pausedAt: earlier,
      },
    });
    const v1 = (await db.match.findUniqueOrThrow({ where: { id: m1.id } })).version;

    const p = await pauseTournament(admin, { reason: "Pizza ist da" }, opts);
    expect(p.pausedMatches).toEqual([m1.code]);
    const tour = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(tour.isPaused).toBe(true);
    const a1 = await db.match.findUniqueOrThrow({ where: { id: m1.id } });
    expect(a1.pausedAt?.getTime()).toBe(tour.pausedAt?.getTime());
    expect(a1.version).toBe(v1 + 1);
    expect((await db.match.findUniqueOrThrow({ where: { id: m2.id } })).pausedAt?.getTime()).toBe(
      earlier.getTime(),
    );
    expect((await db.match.findUniqueOrThrow({ where: { id: m3.id } })).pausedAt).toBeNull();
    expect(await code(pauseTournament(admin, {}, opts))).toBe("INVALID_STATE");

    const r = await resumeTournament(admin, opts);
    expect(r.resumedMatches).toEqual([m1.code]);
    const b1 = await db.match.findUniqueOrThrow({ where: { id: m1.id } });
    expect(b1.pausedAt).toBeNull();
    expect(b1.pausedDurationMs).toBeGreaterThanOrEqual(0);
    expect((await db.match.findUniqueOrThrow({ where: { id: m2.id } })).pausedAt?.getTime()).toBe(
      earlier.getTime(),
    );
    const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ isPaused: false, pausedAt: null });
    expect(await code(resumeTournament(admin, opts))).toBe("INVALID_STATE");

    const events = await db.matchEvent.findMany({ where: { matchId: m1.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["PAUSED", "RESUMED"]);
    expect(await db.matchEvent.count({ where: { matchId: m2.id } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: { in: ["tournament.pause", "tournament.resume"] } } }),
    ).toBe(2);
  });
});

describe("authorization & revision", () => {
  it("PLAYER and REFEREE get FORBIDDEN for every admin service", async () => {
    const t = await makeTournament({ status: "REGISTRATION_OPEN" });
    const table = await db.gameTable.findFirstOrThrow({ where: { tournamentId: t.id } });
    const opts = { tournamentId: t.id };
    for (const role of ["PLAYER", "REFEREE"] as const) {
      const a = actor(await makeUser({ role }));
      const calls: Promise<unknown>[] = [
        updateSettings(a, { name: "Hack" }, opts),
        openRegistration(a, opts),
        lockRegistration(a, opts),
        reopenRegistration(a, opts),
        cancelTournament(a, { reason: "weil", confirmText: CANCEL_CONFIRM_TEXT }, opts),
        generateDraw(a, {}, opts),
        startGroupStage(a, opts),
        resetDraw(a, { reason: "weil halt", confirmText: RESET_DRAW_CONFIRM_TEXT }, opts),
        startKnockout(a, opts),
        pauseTournament(a, {}, opts),
        resumeTournament(a, opts),
        recordRankingShootout(a, { group: "A", basisHash: "x", orderedTeamIds: [] }, opts),
        voidRankingShootout(a, "nope", "weil halt", opts),
        setTableDisabled(a, table.id, true, "kaputt"),
        renameTable(a, table.id, "Tisch X"),
      ];
      for (const c of calls) expect(await code(c)).toBe("FORBIDDEN");
    }
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).revision).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("revision increases after each mutation", async () => {
    const admin = await makeAdmin();
    const t = await makeTournament();
    await addCompleteTeams(t.id, 12);
    const opts = { tournamentId: t.id };
    const steps: (() => Promise<unknown>)[] = [
      () => openRegistration(admin, opts),
      () => updateSettings(admin, { bombRuleEnabled: true }, opts),
      () => lockRegistration(admin, opts),
      () => reopenRegistration(admin, opts),
      () => lockRegistration(admin, opts),
      () => generateDraw(admin, {}, opts),
      () => startGroupStage(admin, opts),
      () => pauseTournament(admin, {}, opts),
      () => resumeTournament(admin, opts),
      () => resetDraw(admin, { reason: "Test-Reset", confirmText: RESET_DRAW_CONFIRM_TEXT }, opts),
      () => cancelTournament(admin, { reason: "Ende Test", confirmText: CANCEL_CONFIRM_TEXT }, opts),
    ];
    let last = await revision(t.id);
    for (const step of steps) {
      await step();
      const now = await revision(t.id);
      expect(now).toBeGreaterThan(last);
      last = now;
    }
    // A refused mutation does not bump the revision.
    expect(await code(openRegistration(admin, opts))).toBe("INVALID_TRANSITION");
    expect(await revision(t.id)).toBe(last);
  });
});

describe("demo seed", () => {
  it("creates 24 players in 12 complete teams plus a referee, idempotently", async () => {
    const t = await makeTournament();
    const r = await createDemoParticipants(db, { tournamentId: t.id, password: "demo-passwort-123" });
    expect(r).toMatchObject({ created: true, users: 24, teams: 12, referees: 1 });
    expect(await db.user.count({ where: { email: { endsWith: "@pharmapong.test" }, role: "PLAYER" } })).toBe(
      24,
    );
    expect((await db.user.findUniqueOrThrow({ where: { email: DEMO_REFEREE_EMAIL } })).role).toBe("REFEREE");
    const o = await getTournamentOverview(t.id);
    expect(o).toMatchObject({
      status: "REGISTRATION_OPEN",
      counts: { teams: 12, completeTeams: 12, incompleteTeams: 0, players: 24 },
    });
    const names = (await db.team.findMany({ select: { name: true } })).map((x) => x.name).sort();
    expect(names).toEqual(DEMO_TEAMS.map((x) => x.name).sort());

    const again = await createDemoParticipants(db, { tournamentId: t.id, password: "demo-passwort-123" });
    expect(again.created).toBe(false);
    expect(await db.user.count()).toBe(25);
    expect(await db.team.count()).toBe(12);
  });

  it("seedDemo creates the tournament when missing and supports a full draw", async () => {
    const r = await seedDemo(db, { password: "demo-passwort-123" });
    expect(r.created).toBe(true);
    const admin = await makeAdmin();
    const opts = { tournamentId: r.tournamentId };
    await lockRegistration(admin, opts);
    const draw = await generateDraw(admin, {}, opts);
    expect(draw.groups.flatMap((g) => g.teams)).toHaveLength(12);
  });

  it("is refused in production unless ALLOW_DEMO_SEED=true", async () => {
    const t = await makeTournament();
    const prev = { NODE_ENV: process.env.NODE_ENV, ALLOW: process.env.ALLOW_DEMO_SEED };
    const env = process.env as Record<string, string | undefined>;
    try {
      env.NODE_ENV = "production";
      delete env.ALLOW_DEMO_SEED;
      expect(
        await code(createDemoParticipants(db, { tournamentId: t.id, password: "demo-passwort-123" })),
      ).toBe("FORBIDDEN");
      expect(await db.user.count()).toBe(0);
    } finally {
      env.NODE_ENV = prev.NODE_ENV;
      if (prev.ALLOW === undefined) delete env.ALLOW_DEMO_SEED;
      else env.ALLOW_DEMO_SEED = prev.ALLOW;
    }
  });

  it("refuses after the roster lock", async () => {
    const t = await makeTournament({ status: "REGISTRATION_LOCKED" });
    expect(
      await code(createDemoParticipants(db, { tournamentId: t.id, password: "demo-passwort-123" })),
    ).toBe("INVALID_STATE");
    expect(await db.user.count()).toBe(0);
  });
});
