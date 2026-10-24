import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { RULES } from "@/server/auth/throttle";
import {
  adminAddMember,
  adminCreateTeam,
  adminDissolveTeam,
  adminRemoveMember,
  adminRenameTeam,
  adminReplaceMember,
  adminSetMotto,
  createTeam,
  getMyTeam,
  getTeamPreviewByCode,
  JOIN_PREVIEW_RULE,
  joinTeam,
  leaveTeam,
  listTeamsAdmin,
  listTeamsPublic,
  lookupTeamPreview,
  rotateInviteCode,
  setReady,
  updateTeam,
} from "@/server/services/teams";
import { makeTournament, makeUser } from "./factories";

type U = Awaited<ReturnType<typeof makeUser>>;
const actor = (u: U): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

async function code(err: Promise<unknown>): Promise<string> {
  try {
    await err;
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
  return "RESOLVED";
}

async function setup(status: "DRAFT" | "REGISTRATION_OPEN" = "REGISTRATION_OPEN") {
  const t = await makeTournament({ status });
  return { t, opts: { tournamentId: t.id } };
}

async function setStatus(id: string, status: "REGISTRATION_LOCKED" | "GROUP_STAGE" | "COMPLETED") {
  await db.tournament.update({ where: { id }, data: { status } });
}

describe("team formation", () => {
  it("creates a team with an invite code and the creator in slot 1", async () => {
    const { opts } = await setup();
    const a = await makeUser();
    const r = await createTeam(
      actor(a),
      { name: "  Die   Pipetten ", motto: "Präzise bis zum Schluss" },
      opts,
    );
    expect(r.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const mine = await getMyTeam(a.id, opts);
    expect(mine?.name).toBe("Die Pipetten");
    expect(mine?.members).toEqual([expect.objectContaining({ userId: a.id, slot: 1, isReady: false })]);
    expect(mine?.complete).toBe(false);
    const audit = await db.auditLog.findMany({ where: { entityId: r.teamId, action: "team.create" } });
    expect(audit).toHaveLength(1);
  });

  it("partner joins → complete; third user gets TEAM_FULL", async () => {
    const { opts } = await setup();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const { inviteCode } = await createTeam(actor(a), { name: "Titrators" }, opts);
    const joined = await joinTeam(actor(b), inviteCode.toLowerCase(), opts);
    expect(joined.slot).toBe(2);
    const mine = await getMyTeam(b.id, opts);
    expect(mine?.complete).toBe(true);
    expect(mine?.eligible).toBe(true);
    expect(mine?.members.map((m) => m.displayName)).toEqual([a.displayName, b.displayName]);
    expect(await code(joinTeam(actor(c), inviteCode, opts))).toBe("TEAM_FULL");
  });

  it("two users racing for the last slot: exactly one succeeds", async () => {
    const { opts } = await setup();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const { teamId, inviteCode } = await createTeam(actor(a), { name: "Race" }, opts);
    const results = await Promise.allSettled([
      joinTeam(actor(b), inviteCode, opts),
      joinTeam(actor(c), inviteCode, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("TEAM_FULL");
    expect(await db.teamMember.count({ where: { teamId, leftAt: null } })).toBe(2);
  });

  it("same user racing to join two teams: exactly one succeeds", async () => {
    const { t, opts } = await setup();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const t1 = await createTeam(actor(a), { name: "Eins" }, opts);
    const t2 = await createTeam(actor(b), { name: "Zwei" }, opts);
    const results = await Promise.allSettled([
      joinTeam(actor(c), t1.inviteCode, opts),
      joinTeam(actor(c), t2.inviteCode, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("ALREADY_IN_TEAM");
    expect(await db.teamMember.count({ where: { tournamentId: t.id, userId: c.id, leftAt: null } })).toBe(1);
  });

  it("a member cannot create or join another team", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    await createTeam(actor(a), { name: "Erstes" }, opts);
    const other = await createTeam(actor(b), { name: "Zweites" }, opts);
    expect(await code(createTeam(actor(a), { name: "Drittes" }, opts))).toBe("ALREADY_IN_TEAM");
    expect(await code(joinTeam(actor(a), other.inviteCode, opts))).toBe("ALREADY_IN_TEAM");
  });

  it("leaving before lock works; after lock it is ROSTER_LOCKED", async () => {
    const { t, opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode, teamId } = await createTeam(actor(a), { name: "Leavers" }, opts);
    await joinTeam(actor(b), inviteCode, opts);
    expect(await leaveTeam(actor(b), opts)).toEqual({ dissolved: false });
    expect(await getMyTeam(b.id, opts)).toBeNull();
    await joinTeam(actor(b), inviteCode, opts);
    await setStatus(t.id, "REGISTRATION_LOCKED");
    expect(await code(leaveTeam(actor(b), opts))).toBe("ROSTER_LOCKED");
    expect(await code(createTeam(actor(b), { name: "X Y" }, opts))).toBe("ROSTER_LOCKED");
    expect(await db.teamMember.count({ where: { teamId, leftAt: null } })).toBe(2);
  });

  it("slot-1 member leaving keeps the partner in slot 2", async () => {
    const { opts } = await setup();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const { inviteCode } = await createTeam(actor(a), { name: "Slots" }, opts);
    await joinTeam(actor(b), inviteCode, opts);
    await leaveTeam(actor(a), opts);
    const mine = await getMyTeam(b.id, opts);
    expect(mine?.members).toEqual([expect.objectContaining({ userId: b.id, slot: 2 })]);
    const r = await joinTeam(actor(c), inviteCode, opts);
    expect(r.slot).toBe(1);
  });

  it("last member leaving dissolves the team and frees the name", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { teamId, inviteCode } = await createTeam(actor(a), { name: "Ephemer" }, opts);
    expect(await leaveTeam(actor(a), opts)).toEqual({ dissolved: true });
    const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(team.status).toBe("DISSOLVED");
    expect(await code(joinTeam(actor(b), inviteCode, opts))).toBe("INVALID_INVITE");
    expect(await getTeamPreviewByCode(inviteCode)).toBeNull();
    const again = await createTeam(actor(b), { name: "EPHEMER" }, opts);
    expect(again.teamId).not.toBe(teamId);
  });

  it("team names are unique case- and whitespace-insensitively", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    await createTeam(actor(a), { name: "Beaker  Boys" }, opts);
    expect(await code(createTeam(actor(b), { name: "  beaker boys " }, opts))).toBe("NAME_TAKEN");
  });

  it("rotating the code invalidates the old one", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode: oldCode } = await createTeam(actor(a), { name: "Rotor" }, opts);
    const { inviteCode: newCode } = await rotateInviteCode(actor(a), opts);
    expect(newCode).not.toBe(oldCode);
    expect(await code(joinTeam(actor(b), oldCode, opts))).toBe("INVALID_INVITE");
    await joinTeam(actor(b), newCode, opts);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "team.rotate_invite" } });
    expect(JSON.stringify({ ...audit, id: String(audit.id) })).not.toContain(newCode);
  });

  it("repeated invalid codes eventually lock the user out (RATE_LIMITED)", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode } = await createTeam(actor(a), { name: "Fort Knox" }, opts);
    const codes: string[] = [];
    for (let i = 0; i < RULES.join.limit + 1; i++)
      codes.push(await code(joinTeam(actor(b), "ZZZZZZZZ", opts)));
    expect(codes.slice(0, RULES.join.limit - 1).every((c) => c === "INVALID_INVITE")).toBe(true);
    expect(codes.at(-1)).toBe("RATE_LIMITED");
    // Even a valid code is refused while locked.
    expect(await code(joinTeam(actor(b), inviteCode, opts))).toBe("RATE_LIMITED");
  });

  it("a parallel burst of join attempts cannot exceed the throttle limit", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode, teamId } = await createTeam(actor(a), { name: "Burst Proof" }, opts);
    const n = RULES.join.limit * 2;
    // n wrong guesses fired at once, plus the valid code at the very end of the burst.
    const results = await Promise.all([
      ...Array.from({ length: n }, (_, i) =>
        code(joinTeam(actor(b), `WRONG${String(i).padStart(3, "0")}`, opts)),
      ),
      code(joinTeam(actor(b), inviteCode, opts)),
    ]);
    const invalid = results.filter((c) => c === "INVALID_INVITE").length;
    const limited = results.filter((c) => c === "RATE_LIMITED").length;
    // At most limit lookups were evaluated: limit-1 plain misses, the limit-th miss locks.
    expect(invalid).toBeLessThanOrEqual(RULES.join.limit - 1);
    const row = await db.authThrottle.findUnique({ where: { key: `join:user:${b.id}` } });
    expect(row!.count).toBeLessThanOrEqual(RULES.join.limit);
    expect(row!.lockedUntil).not.toBeNull();
    // Every attempt either missed, got rate limited, or (if it ran before the lock) joined.
    const joined = results.filter((c) => c === "RESOLVED").length;
    expect(invalid + limited + joined).toBe(n + 1);
    const members = await db.teamMember.count({ where: { teamId, leftAt: null } });
    expect(members).toBe(1 + joined);
  });

  it("the public preview lookup is throttled per IP and counts only misses", async () => {
    const { opts } = await setup();
    const a = await makeUser();
    const { inviteCode } = await createTeam(actor(a), { name: "Preview Team" }, opts);
    const ip = "203.0.113.7";
    // Valid lookups do not count.
    for (let i = 0; i < JOIN_PREVIEW_RULE.limit + 5; i++) {
      expect((await lookupTeamPreview(inviteCode, ip)).status).toBe("ok");
    }
    // A parallel burst of misses is bounded by the limit.
    const burst = await Promise.all(
      Array.from({ length: JOIN_PREVIEW_RULE.limit * 2 }, (_, i) =>
        lookupTeamPreview(`MISS${String(i).padStart(4, "0")}`, ip),
      ),
    );
    const misses = burst.filter((r) => r.status === "not_found").length;
    expect(misses).toBe(JOIN_PREVIEW_RULE.limit - 1);
    expect(burst.filter((r) => r.status === "rate_limited").length).toBe(JOIN_PREVIEW_RULE.limit + 1);
    // Locked: even a valid code reveals nothing now; other IPs are unaffected.
    expect((await lookupTeamPreview(inviteCode, ip)).status).toBe("rate_limited");
    const other = await lookupTeamPreview(inviteCode, "198.51.100.1");
    expect(other.status).toBe("ok");
    expect(other.status === "ok" && other.preview.name).toBe("Preview Team");
  });

  it("services enforce name (2–32) and motto (≤80) limits for direct callers", async () => {
    const { opts } = await setup();
    const [a, admin] = await Promise.all([makeUser(), makeUser({ role: "ADMIN" })]);
    expect(await code(createTeam(actor(a), { name: " x " }, opts))).toBe("VALIDATION");
    expect(await code(createTeam(actor(a), { name: "a".repeat(33) }, opts))).toBe("VALIDATION");
    expect(await code(createTeam(actor(a), { name: "Okay", motto: "m".repeat(81) }, opts))).toBe(
      "VALIDATION",
    );
    const { teamId } = await createTeam(actor(a), { name: "a".repeat(32), motto: "   " }, opts);
    const team = (await getMyTeam(a.id, opts))!;
    expect(team.motto).toBeNull();
    expect(await code(updateTeam(actor(a), { teamId, expectedVersion: team.version, name: "" }))).toBe(
      "VALIDATION",
    );
    expect(
      await code(updateTeam(actor(a), { teamId, expectedVersion: team.version, motto: "m".repeat(81) })),
    ).toBe("VALIDATION");
    const reason = "Reparatur";
    expect(await code(adminRenameTeam(actor(admin), { teamId, name: "z", reason }))).toBe("VALIDATION");
    expect(await code(adminSetMotto(actor(admin), { teamId, motto: "m".repeat(81), reason }))).toBe(
      "VALIDATION",
    );
    expect(
      await code(adminCreateTeam(actor(admin), { name: "b".repeat(40), memberUserIds: [], reason }, opts)),
    ).toBe("VALIDATION");
    // Nothing was written by the rejected calls.
    expect((await db.team.findUnique({ where: { id: teamId } }))!.version).toBe(team.version);
    expect(await db.team.count()).toBe(1);
  });

  it("STALE_VERSION on stale update; name locked after roster lock but motto editable", async () => {
    const { t, opts } = await setup();
    const a = await makeUser();
    const { teamId } = await createTeam(actor(a), { name: "Versioned" }, opts);
    const v0 = (await getMyTeam(a.id, opts))!.version;
    const { version: v1 } = await updateTeam(actor(a), { teamId, expectedVersion: v0, motto: "Neu" });
    expect(v1).toBe(v0 + 1);
    expect(await code(updateTeam(actor(a), { teamId, expectedVersion: v0, motto: "Alt" }))).toBe(
      "STALE_VERSION",
    );
    await setStatus(t.id, "REGISTRATION_LOCKED");
    expect(await code(updateTeam(actor(a), { teamId, expectedVersion: v1, name: "Renamed" }))).toBe(
      "ROSTER_LOCKED",
    );
    const { version: v2 } = await updateTeam(actor(a), { teamId, expectedVersion: v1, motto: "Später" });
    expect(v2).toBe(v1 + 1);
  });

  it("non-members cannot update a team", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { teamId } = await createTeam(actor(a), { name: "Private" }, opts);
    expect(await code(updateTeam(actor(b), { teamId, expectedVersion: 0, motto: "hijack" }))).toBe(
      "FORBIDDEN",
    );
  });

  it("readiness toggles per member", async () => {
    const { opts } = await setup();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode } = await createTeam(actor(a), { name: "Ready" }, opts);
    await joinTeam(actor(b), inviteCode, opts);
    await setReady(actor(a), true, opts);
    const mine = await getMyTeam(a.id, opts);
    expect(mine?.members.map((m) => m.isReady)).toEqual([true, false]);
  });

  it("DRAFT blocks creation with INVALID_STATE", async () => {
    const { opts } = await setup("DRAFT");
    const a = await makeUser();
    const err = await createTeam(actor(a), { name: "Too Early" }, opts).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
    expect(err.message).toBe("Die Anmeldung ist noch nicht geöffnet.");
  });

  it("listTeamsPublic contains no emails or invite codes", async () => {
    const { t, opts } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { inviteCode } = await createTeam(actor(a), { name: "Public" }, opts);
    await joinTeam(actor(b), inviteCode, opts);
    const list = await listTeamsPublic(t.id);
    expect(list).toHaveLength(1);
    expect(list[0].memberDisplayNames).toHaveLength(2);
    const json = JSON.stringify(list);
    expect(json).not.toContain("@");
    expect(json).not.toContain(inviteCode);
    const preview = JSON.stringify(await getTeamPreviewByCode(inviteCode));
    expect(preview).not.toContain("@");
    expect(preview).toContain('"memberCount":2');
    const adminList = await listTeamsAdmin(actor(admin), t.id);
    expect(adminList[0].inviteCode).toBe(inviteCode);
    expect(adminList[0].members[0].email).toContain("@");
    expect(await code(listTeamsAdmin(actor(a), t.id))).toBe("FORBIDDEN");
  });
});

describe("admin team repair", () => {
  it("replaces an absent member after lock and audits it", async () => {
    const { t, opts } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const { teamId, inviteCode } = await createTeam(actor(a), { name: "Repair" }, opts);
    await joinTeam(actor(b), inviteCode, opts);
    await setStatus(t.id, "GROUP_STAGE");
    const reason = "Spielerin krank";
    await adminReplaceMember(actor(admin), { teamId, oldUserId: b.id, newUserId: c.id, reason });
    const mine = await getMyTeam(c.id, opts);
    expect(mine?.members.map((m) => [m.userId, m.slot])).toEqual([
      [a.id, 1],
      [c.id, 2],
    ]);
    expect(await getMyTeam(b.id, opts)).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "admin.team.replace_member" } });
    expect(audit).toMatchObject({ actorId: admin.id, entityId: teamId, reason });
  });

  it("is admin-only and prevents a user in two active teams", async () => {
    const { opts } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const t1 = await createTeam(actor(a), { name: "One" }, opts);
    await createTeam(actor(b), { name: "Two" }, opts);
    expect(await code(adminAddMember(actor(c), { teamId: t1.teamId, userId: c.id, reason: "selbst" }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await code(adminAddMember(actor(admin), { teamId: t1.teamId, userId: b.id, reason: "test" })),
    ).toBe("ALREADY_IN_TEAM");
    await adminAddMember(actor(admin), { teamId: t1.teamId, userId: c.id, reason: "Nachmeldung" });
    expect((await getMyTeam(c.id, opts))?.complete).toBe(true);
  });

  it("creates, removes and dissolves with audit; dissolve blocked from group stage", async () => {
    const { t, opts } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const created = await adminCreateTeam(
      actor(admin),
      { name: "Admin Made", memberUserIds: [a.id, b.id], reason: "Registrierung kaputt" },
      opts,
    );
    expect((await getMyTeam(b.id, opts))?.complete).toBe(true);
    const r = await adminRemoveMember(actor(admin), {
      teamId: created.teamId,
      userId: b.id,
      reason: "falsch",
    });
    expect(r.dissolved).toBe(false);
    await setStatus(t.id, "GROUP_STAGE");
    expect(await code(adminDissolveTeam(actor(admin), { teamId: created.teamId, reason: "weg" }))).toBe(
      "INVALID_STATE",
    );
    await db.tournament.update({ where: { id: t.id }, data: { status: "REGISTRATION_LOCKED" } });
    await adminDissolveTeam(actor(admin), { teamId: created.teamId, reason: "weg" });
    expect((await db.team.findUniqueOrThrow({ where: { id: created.teamId } })).status).toBe("DISSOLVED");
    const actions = (await db.auditLog.findMany({ where: { entityId: created.teamId } })).map(
      (x) => x.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(["admin.team.create", "admin.team.remove_member", "admin.team.dissolve"]),
    );
  });

  it("refuses repairs once the tournament is completed", async () => {
    const { t, opts } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { teamId } = await createTeam(actor(a), { name: "Done" }, opts);
    await setStatus(t.id, "COMPLETED");
    expect(await code(adminAddMember(actor(admin), { teamId, userId: b.id, reason: "zu spät" }))).toBe(
      "INVALID_STATE",
    );
  });
});
