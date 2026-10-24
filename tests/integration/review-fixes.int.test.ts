// Regression tests for the cross-package review findings (recovery scope,
// champion re-announcement, corrected status, paused rejection, own-match
// guard, override unassign, settings guard, profile revision, sim admin,
// reserved demo domain, pending password change).
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import { registerUser, updateProfile } from "@/server/services/auth";
import { correctResult, executeRecovery, planRecovery } from "@/server/services/corrections";
import { handleExportRequest } from "@/server/services/export";
import { handleAuthedLive } from "@/server/services/live-snapshot";
import { assignMatch, startMatch, unassignMatch } from "@/server/services/matches";
import { confirmResult, forfeitMatch, proposeResult, rejectProposal } from "@/server/services/results";
import { pauseTournament, resumeTournament, updateSettings } from "@/server/services/tournament";
import { ensureSimAdmin, SIM_ADMIN_EMAIL } from "@/server/sim/simulate-tournament";
import type { Match } from "@/generated/prisma/client";
import { makeTeam, makeUser } from "./factories";
import {
  actorOf,
  assertInvariants,
  assignAndStart,
  buildDrawnTournament,
  buildKnockoutTournament,
  errorCode,
  getMatch,
  getTournament,
  idemKey,
  playMatch,
  seedGroupResults,
  type Fixture,
} from "./match-fixtures";

let current: Fixture | null = null;

afterEach(async () => {
  if (current) await assertInvariants(current.t.id);
  current = null;
});

const awayWins = (m: Match) => ({
  winnerTeamId: m.awayTeamId!,
  homeCupsRemaining: 0,
  awayCupsRemaining: 2,
  endType: "REGULAR" as const,
});
const homeWins = (m: Match, cups = 2) => ({
  winnerTeamId: m.homeTeamId!,
  homeCupsRemaining: cups,
  awayCupsRemaining: 0,
  endType: "REGULAR" as const,
});

async function propose(fx: Fixture, code: string, referee = fx.referee) {
  const m = await getMatch(fx, code);
  return proposeResult(referee, {
    matchId: m.id,
    expectedVersion: m.version,
    idempotencyKey: idemKey(),
    ...homeWins(m, 3),
  });
}

describe("recovery scope for group corrections in the knockout stage", () => {
  it("voids only the downstream matches and stays in the knockout stage", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3"]) await playMatch(fx, code, { winner: "HOME" });
    const [qf1Before, qf2Before] = [await getMatch(fx, "QF1"), await getMatch(fx, "QF2")];
    // C-1: position 1 beat position 2. Flipping it swaps C1 and C2 (no tie).
    const c1 = await getMatch(fx, "C-1");
    expect(
      await errorCode(
        correctResult(fx.admin, {
          matchId: c1.id,
          expectedVersion: c1.version,
          reason: "Falsches Siegerteam",
          ...awayWins(c1),
        }),
      ),
    ).toBe("DOWNSTREAM_STARTED");

    const plan = await planRecovery(fx.admin, { matchId: c1.id, newResult: awayWins(c1) });
    expect(plan.resetsKnockout).toBe(false);
    expect(plan.affected.map((a) => a.code)).toEqual(["QF3", "QF4", "SF1", "SF2", "F"]);

    const r = await executeRecovery(fx.admin, {
      matchId: c1.id,
      expectedVersion: c1.version,
      reason: "Falsches Siegerteam in der Gruppe",
      confirmText: "C-1 ZURÜCKSETZEN",
      newResult: awayWins(c1),
    });
    expect(r.tournamentStatus).toBe("KNOCKOUT_STAGE");
    expect(r.voided).toEqual(["F", "SF2", "SF1", "QF4", "QF3"]);
    expect(await getTournament(fx)).toMatchObject({ status: "KNOCKOUT_STAGE" });

    // Untouched quarterfinals keep their results and versions.
    expect(await getMatch(fx, "QF1")).toEqual(qf1Before);
    expect(await getMatch(fx, "QF2")).toEqual(qf2Before);
    const [newC1, newC2] = [fx.groups.C[1], fx.groups.C[0]];
    expect(await getMatch(fx, "QF3")).toMatchObject({
      status: "READY",
      homeTeamId: newC1,
      awayTeamId: qualifiers.D2,
      winnerTeamId: null,
    });
    expect(await getMatch(fx, "QF4")).toMatchObject({
      status: "READY",
      homeTeamId: qualifiers.D1,
      awayTeamId: newC2,
    });
    expect(await getMatch(fx, "SF1")).toMatchObject({
      status: "PENDING",
      homeTeamId: qualifiers.A1,
      awayTeamId: null,
    });
    expect(await getMatch(fx, "SF2")).toMatchObject({
      status: "PENDING",
      homeTeamId: qualifiers.B1,
      awayTeamId: null,
    });
    expect(await db.auditLog.count({ where: { action: "match.void" } })).toBe(5);

    // The bracket can be finished normally.
    for (const code of ["QF3", "QF4", "SF1", "SF2", "F"]) await playMatch(fx, code, { winner: "HOME" });
    expect(await getTournament(fx)).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.A1 });
  });

  it("after the final: narrow recovery reopens the knockout stage and clears the champion", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"])
      await playMatch(fx, code, { winner: "HOME" });
    const c1 = await getMatch(fx, "C-1");
    const r = await executeRecovery(fx.admin, {
      matchId: c1.id,
      expectedVersion: c1.version,
      reason: "Falsches Siegerteam in der Gruppe",
      confirmText: "C-1 ZURÜCKSETZEN",
      newResult: awayWins(c1),
    });
    expect(r).toMatchObject({ tournamentStatus: "KNOCKOUT_STAGE", championTeamId: null });
    expect(await getTournament(fx)).toMatchObject({ status: "KNOCKOUT_STAGE", championTeamId: null });
    expect((await getMatch(fx, "QF1")).status).toBe("COMPLETED");
    expect((await getMatch(fx, "QF3")).status).toBe("READY");
  });
});

describe("corrections", () => {
  it("correcting only the cups of the final does not re-announce the champion", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    for (const code of ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"])
      await playMatch(fx, code, { winner: "HOME" });
    const f = await getMatch(fx, "F");
    const r = await correctResult(fx.admin, {
      matchId: f.id,
      expectedVersion: f.version,
      reason: "Becher falsch gezählt",
      ...homeWins(f, 7),
    });
    expect(r.championTeamId).toBe(qualifiers.A1);
    expect(await db.matchEvent.count({ where: { type: "CHAMPION" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "tournament.champion_change" } })).toBe(0);
    expect(await getTournament(fx)).toMatchObject({ status: "COMPLETED", championTeamId: qualifiers.A1 });
  });

  it("the match status follows the corrected end type (FORFEITED ↔ COMPLETED)", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await seedGroupResults(fx, { except: ["A-1"] });
    const a1 = await getMatch(fx, "A-1");
    await forfeitMatch(fx.admin, { matchId: a1.id, winnerTeamId: a1.homeTeamId!, reason: "Team fehlt" });
    const forfeited = await getMatch(fx, "A-1");
    expect(forfeited.status).toBe("FORFEITED");

    await correctResult(fx.admin, {
      matchId: a1.id,
      expectedVersion: forfeited.version,
      reason: "Team war doch da",
      ...homeWins(forfeited, 4),
    });
    const completed = await getMatch(fx, "A-1");
    expect(completed).toMatchObject({ status: "COMPLETED", endType: "REGULAR", homeCupsRemaining: 4 });

    await correctResult(fx.admin, {
      matchId: a1.id,
      expectedVersion: completed.version,
      reason: "Doch Forfait",
      winnerTeamId: completed.homeTeamId!,
      homeCupsRemaining: 10,
      awayCupsRemaining: 0,
      endType: "FORFEIT",
    });
    expect(await getMatch(fx, "A-1")).toMatchObject({ status: "FORFEITED", endType: "FORFEIT" });
  });
});

describe("rejecting a proposal while the tournament is paused", () => {
  it("proposal before the pause: the clock stays stopped until the tournament resumes", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await assignAndStart(fx, "A-1");
    await propose(fx, "A-1");
    const proposed = await getMatch(fx, "A-1");
    await pauseTournament(fx.admin, {}, { tournamentId: fx.t.id });
    const pausedAt = (await getTournament(fx)).pausedAt!;

    await rejectProposal(fx.referee, { matchId: proposed.id, expectedVersion: proposed.version });
    const rejected = await getMatch(fx, "A-1");
    expect(rejected.status).toBe("IN_PROGRESS");
    expect(rejected.endedAt).toBeNull();
    expect(rejected.pausedAt).toEqual(pausedAt);

    await resumeTournament(fx.admin, { tournamentId: fx.t.id });
    const resumed = await getMatch(fx, "A-1");
    expect(resumed.pausedAt).toBeNull();
    const ev = await db.matchEvent.findFirstOrThrow({
      where: { matchId: proposed.id, type: "RESUMED" },
      orderBy: { createdAt: "desc" },
    });
    const resumeAt = pausedAt.getTime() + (ev.payload as { pausedMs: number }).pausedMs;
    // Everything from the proposal until the resume counts as stopped time.
    expect(resumed.pausedDurationMs).toBe(
      proposed.pausedDurationMs + (resumeAt - proposed.endedAt!.getTime()),
    );
  });

  it("proposal during the pause: the clock stays stopped at the pause start", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const started = await assignAndStart(fx, "A-1");
    await pauseTournament(fx.admin, {}, { tournamentId: fx.t.id });
    const pausedAt = (await getTournament(fx)).pausedAt!;
    await propose(fx, "A-1");
    const proposed = await getMatch(fx, "A-1");
    await rejectProposal(fx.referee, { matchId: proposed.id, expectedVersion: proposed.version });
    expect((await getMatch(fx, "A-1")).pausedAt).toEqual(pausedAt);

    const r = await resumeTournament(fx.admin, { tournamentId: fx.t.id });
    expect(r.resumedMatches).toEqual(["A-1"]);
    const resumed = await getMatch(fx, "A-1");
    const ev = await db.matchEvent.findFirstOrThrow({
      where: { matchId: proposed.id, type: "RESUMED" },
      orderBy: { createdAt: "desc" },
    });
    const resumeAt = pausedAt.getTime() + (ev.payload as { pausedMs: number }).pausedMs;
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pausedDurationMs).toBe(started.pausedDurationMs + (resumeAt - pausedAt.getTime()));
  });

  it("without a tournament pause the clock continues from where it stopped", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await assignAndStart(fx, "A-1");
    await propose(fx, "A-1");
    const proposed = await getMatch(fx, "A-1");
    await rejectProposal(fx.referee, { matchId: proposed.id, expectedVersion: proposed.version });
    const rejected = await getMatch(fx, "A-1");
    expect(rejected.pausedAt).toBeNull();
    expect(rejected.pausedDurationMs).toBeGreaterThanOrEqual(proposed.pausedDurationMs);
  });
});

describe("referees never officiate their own team", () => {
  it("start, propose, reject and confirm are FORBIDDEN for a member; another referee may", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const [member, other] = fx.referees;
    const m = await getMatch(fx, "A-1");
    await db.teamMember.create({
      data: { tournamentId: fx.t.id, teamId: m.homeTeamId!, userId: member.id, slot: 1 },
    });
    const a = await assignMatch(fx.admin, {
      matchId: m.id,
      tableId: fx.tables[0].id,
      expectedVersion: m.version,
    });
    expect(await errorCode(startMatch(member, { matchId: m.id, expectedVersion: a.version }))).toBe(
      "FORBIDDEN",
    );
    await startMatch(other, { matchId: m.id, expectedVersion: a.version });
    expect(await errorCode(propose(fx, "A-1", member))).toBe("FORBIDDEN");
    const p = await propose(fx, "A-1", other);
    expect(await errorCode(rejectProposal(member, { matchId: m.id, expectedVersion: p.version }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await errorCode(
        confirmResult(member, {
          matchId: m.id,
          expectedVersion: p.version,
          resultRevision: p.resultRevision,
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("FORBIDDEN");
    expect((await getMatch(fx, "A-1")).status).toBe("AWAITING_CONFIRMATION");
    const c = await confirmResult(other, {
      matchId: m.id,
      expectedVersion: p.version,
      resultRevision: p.resultRevision,
      idempotencyKey: idemKey(),
    });
    expect(c.status).toBe("COMPLETED");
  });

  it("a former member (left the team) is not blocked", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const m = await getMatch(fx, "A-1");
    await db.teamMember.create({
      data: {
        tournamentId: fx.t.id,
        teamId: m.homeTeamId!,
        userId: fx.referee.id,
        slot: 1,
        leftAt: new Date(),
      },
    });
    const started = await assignAndStart(fx, "A-1", fx.referee);
    expect(started.status).toBe("IN_PROGRESS");
  });
});

describe("admin override assignments", () => {
  it("a referee cannot unassign an admin override, but can unassign a suggested assignment", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    // The 4th group match is not the suggestion for table 1 → admin override.
    const matches = await db.match.findMany({
      where: { tournamentId: fx.t.id, stage: "GROUP" },
      orderBy: { orderIndex: "asc" },
    });
    const late = matches[3];
    const a = await assignMatch(fx.admin, {
      matchId: late.id,
      tableId: fx.tables[0].id,
      expectedVersion: late.version,
    });
    expect(a.override).toBe(true);
    expect(await errorCode(unassignMatch(fx.referee, { matchId: late.id, expectedVersion: a.version }))).toBe(
      "FORBIDDEN",
    );
    const u = await unassignMatch(fx.admin, { matchId: late.id, expectedVersion: a.version });
    expect(u.status).toBe("READY");

    const first = await db.match.findUniqueOrThrow({ where: { id: matches[0].id } });
    const s = await assignMatch(fx.referee, {
      matchId: first.id,
      tableId: fx.tables[0].id,
      expectedVersion: first.version,
    });
    expect(s.override).toBe(false);
    const u2 = await unassignMatch(fx.referee, { matchId: first.id, expectedVersion: s.version });
    expect(u2.status).toBe("READY");
  });
});

describe("settings", () => {
  it("the match duration cannot change while a result awaits confirmation", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    await assignAndStart(fx, "A-1");
    await propose(fx, "A-1");
    expect(
      await errorCode(updateSettings(fx.admin, { matchDurationSec: 600 }, { tournamentId: fx.t.id })),
    ).toBe("INVALID_STATE");
  });
});

describe("profile changes and live revisions", () => {
  it("renaming a team member bumps the revision of their tournament", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const u = await makeUser();
    await makeTeam(fx.t.id, [u.id], "Umbenannt");
    const loner = await makeUser();
    const rev0 = (await getTournament(fx)).revision;
    await updateProfile(actorOf(u), { displayName: "Neuer Name" });
    expect((await getTournament(fx)).revision).toBe(rev0 + 1);
    await updateProfile(actorOf(u), { displayName: "Neuer Name" }); // unchanged
    await updateProfile(actorOf(loner), { displayName: "Niemand" });
    expect((await getTournament(fx)).revision).toBe(rev0 + 1);
  });
});

describe("reserved accounts", () => {
  it("self-registration refuses the demo / simulation domain", async () => {
    expect(
      await errorCode(
        registerUser(
          { email: SIM_ADMIN_EMAIL, displayName: "Angreifer", password: "richtig-langes-passwort" },
          { ip: "10.9.9.9", userAgent: "vitest" },
        ),
      ),
    ).toBe("VALIDATION");
    expect(await db.user.count({ where: { email: SIM_ADMIN_EMAIL } })).toBe(0);
  });

  it("ensureSimAdmin never promotes an existing non-admin account", async () => {
    const squatter = await makeUser({ email: SIM_ADMIN_EMAIL, role: "PLAYER" });
    expect(await errorCode(ensureSimAdmin(db))).toBe("FORBIDDEN");
    expect((await db.user.findUniqueOrThrow({ where: { id: squatter.id } })).role).toBe("PLAYER");
  });

  it("ensureSimAdmin creates the account once and reuses it", async () => {
    const a = await ensureSimAdmin(db);
    const b = await ensureSimAdmin(db);
    expect(a.id).toBe(b.id);
    expect(a.role).toBe("ADMIN");
    expect(await db.user.count({ where: { email: SIM_ADMIN_EMAIL } })).toBe(1);
  });
});

describe("pending password change", () => {
  it("export and the authenticated live feed refuse a user who must change the password", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });
    const { token } = await createSession(admin.id, "vitest");
    const session = await validateSessionToken(token);
    expect(session?.user.mustChangePassword).toBe(true);
    const user = session!.user;

    const exp = await handleExportRequest(new Request("http://x/api/admin/export?format=json"), user);
    expect(exp.status).toBe(403);
    const live = await handleAuthedLive(new Request("http://x/api/live"), user, { tournamentId: fx.t.id });
    expect(live.status).toBe(403);

    const ok = { ...user, mustChangePassword: false };
    expect(
      (await handleAuthedLive(new Request("http://x/api/live"), ok, { tournamentId: fx.t.id })).status,
    ).toBe(200);
  });
});
