import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hit, RULES } from "@/server/auth/throttle";
import { createSession, validateSessionToken, type Actor } from "@/server/auth/sessions";
import {
  createResetLink,
  getUserCounts,
  listUsers,
  setActive,
  setRole,
  unlockLogin,
} from "@/server/services/users";
import { unlockLoginSchema } from "@/lib/validation/users";
import { makeTeam, makeTournament, makeUser } from "./factories";

type Row = Awaited<ReturnType<typeof makeUser>>;
const actorOf = (u: Row): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

describe("authorization", () => {
  it("PLAYER and REFEREE get FORBIDDEN for every admin user function", async () => {
    const target = await makeUser();
    for (const role of ["PLAYER", "REFEREE"] as const) {
      const a = actorOf(await makeUser({ role }));
      await expect(setRole(a, target.id, "REFEREE")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setRole(a, a.id, "ADMIN")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setActive(a, target.id, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createResetLink(a, target.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(unlockLogin(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listUsers(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getUserCounts(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("PLAYER");
  });
});

describe("setRole", () => {
  it("ADMIN can promote to REFEREE; old sessions are revoked and a new session has the new role", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    const u = await makeUser();
    const { token } = await createSession(u.id, null);
    expect((await validateSessionToken(token))?.user.role).toBe("PLAYER");
    const r = await setRole(admin, u.id, "REFEREE");
    expect(r).toMatchObject({ role: "REFEREE", changed: true });
    expect(await validateSessionToken(token)).toBeNull();
    const fresh = await createSession(u.id, null);
    expect((await validateSessionToken(fresh.token))?.user.role).toBe("REFEREE");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.role_change" } });
    expect(audit).toMatchObject({ actorId: admin.id, entityId: u.id });
    expect(audit.before).toEqual({ role: "PLAYER" });
  });

  it("demotion revokes the target's sessions", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    const ref = await makeUser({ role: "REFEREE" });
    const { token } = await createSession(ref.id, null);
    await setRole(admin, ref.id, "PLAYER");
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("the last active admin cannot demote themselves", async () => {
    const adminRow = await makeUser({ role: "ADMIN" });
    await expect(setRole(actorOf(adminRow), adminRow.id, "PLAYER")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(setRole(actorOf(adminRow), adminRow.id, "REFEREE")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: adminRow.id } })).role).toBe("ADMIN");
  });

  it("an inactive admin does not count as a remaining admin", async () => {
    const adminRow = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: other.id }, data: { isActive: false } });
    await expect(setRole(actorOf(adminRow), adminRow.id, "PLAYER")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("with two active admins one may step down", async () => {
    const a = await makeUser({ role: "ADMIN" });
    await makeUser({ role: "ADMIN" });
    await expect(setRole(actorOf(a), a.id, "PLAYER")).resolves.toMatchObject({ changed: true });
  });

  it("concurrent mutual demotion of the only two admins leaves one admin", async () => {
    const a = await makeUser({ role: "ADMIN" });
    const b = await makeUser({ role: "ADMIN" });
    const results = await Promise.allSettled([
      setRole(actorOf(a), b.id, "PLAYER"),
      setRole(actorOf(b), a.id, "PLAYER"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);
  });

  it("unchanged role is a no-op without audit", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    const u = await makeUser();
    await expect(setRole(admin, u.id, "PLAYER")).resolves.toMatchObject({ changed: false });
    expect(await db.auditLog.count()).toBe(0);
  });

  it("unknown user → NOT_FOUND", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    await expect(setRole(admin, "nope", "REFEREE")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setActive", () => {
  it("an admin cannot deactivate themselves", async () => {
    const a = await makeUser({ role: "ADMIN" });
    await makeUser({ role: "ADMIN" });
    await expect(setActive(actorOf(a), a.id, false)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("deactivation revokes sessions, reactivation is audited", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    const u = await makeUser();
    await createSession(u.id, null);
    await setActive(admin, u.id, false);
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    await setActive(admin, u.id, true);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(true);
    const actions = (await db.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["user.deactivate", "user.activate"]);
  });
});

describe("createResetLink", () => {
  it("returns an absolute /reset/<token> URL", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    const u = await makeUser();
    const { url, expiresAt } = await createResetLink(admin, u.id);
    expect(url).toMatch(/^https?:\/\/[^/]+\/reset\/[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("unlockLogin", () => {
  it("clears only keys of the given email, or everything", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    for (let i = 0; i < 5; i++) await hit("login:email:locked@test.local", RULES.loginEmail);
    await hit("login:email:other@test.local", RULES.loginEmail);
    await hit("login:ip:1.2.3.4", RULES.loginIp);
    await hit("login:email:xlocked@test.local", RULES.loginEmail);
    await hit("register:ip:1.2.3.4", RULES.register);
    await expect(unlockLogin(admin, " Locked@Test.local ")).resolves.toEqual({ cleared: 1 });
    expect(await db.authThrottle.count()).toBe(4);
    await expect(unlockLogin(admin, "")).resolves.toEqual({ cleared: 4 });
    expect(await db.authThrottle.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "auth.unlock" } })).toBe(2);
  });

  it("rejects partial / non-email input instead of substring-matching", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    await hit("login:email:a@test.local", RULES.loginEmail);
    await hit("login:ip:1.2.3.4", RULES.loginIp);
    for (const bad of ["1", "test.local", "@test.local", "login:"]) {
      await expect(unlockLogin(admin, bad)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(unlockLoginSchema.safeParse({ email: bad }).success).toBe(false);
    }
    expect(unlockLoginSchema.parse({ email: "  " })).toEqual({ email: "" });
    expect(await db.authThrottle.count()).toBe(2);
    expect(await db.auditLog.count({ where: { action: "auth.unlock" } })).toBe(0);
  });
});

describe("listUsers / getUserCounts", () => {
  it("lists users with their active team and filters by query", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN", displayName: "Chefin" }));
    const t = await makeTournament();
    const p1 = await makeUser({ displayName: "Alice Pipette" });
    const p2 = await makeUser({ displayName: "Bob Bürette" });
    const team = await makeTeam(t.id, [p1.id], "Die Titrierer");
    // A left membership does not count.
    const old = await makeTeam(t.id, [], "Alt");
    await db.teamMember.create({
      data: { tournamentId: t.id, teamId: old.id, userId: p2.id, slot: 1, leftAt: new Date() },
    });

    const all = await listUsers(admin);
    expect(all).toHaveLength(3);
    expect(all[0].role).toBe("ADMIN");
    expect(all.find((u) => u.id === p1.id)?.team).toEqual({ id: team.id, name: "Die Titrierer" });
    expect(all.find((u) => u.id === p2.id)?.team).toBeNull();
    expect(all[0]).not.toHaveProperty("passwordHash");

    const filtered = await listUsers(admin, { query: "pipette" });
    expect(filtered.map((u) => u.id)).toEqual([p1.id]);
  });

  it("counts active users by role and inactive users", async () => {
    const admin = actorOf(await makeUser({ role: "ADMIN" }));
    await makeUser();
    await makeUser();
    await makeUser({ role: "REFEREE" });
    const gone = await makeUser();
    await db.user.update({ where: { id: gone.id }, data: { isActive: false } });
    await expect(getUserCounts(admin)).resolves.toEqual({
      players: 2,
      referees: 1,
      admins: 1,
      inactive: 1,
    });
  });
});
