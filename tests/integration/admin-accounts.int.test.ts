import { execFile } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import { createAdminAccount } from "@/server/services/bootstrap";
import { makeUser } from "./factories";

const auditOf = (userId: string) => db.auditLog.findMany({ where: { entityId: userId } });

describe("createAdminAccount", () => {
  it("creates an admin with a one-time password that must be changed at first login", async () => {
    const r = await createAdminAccount({ email: "  Orga@Example.CH " });
    expect(r).toMatchObject({ status: "created", email: "orga@example.ch", displayName: "Turnierleitung" });
    if (r.status !== "created") throw new Error("expected a new account");
    const user = await db.user.findUniqueOrThrow({ where: { email: "orga@example.ch" } });
    expect(user).toMatchObject({ role: "ADMIN", isActive: true, mustChangePassword: true });
    expect(user.passwordHash).not.toContain(r.oneTimePassword);
    expect(await verifyPassword(user.passwordHash, r.oneTimePassword)).toBe(true);
    const audit = await auditOf(user.id);
    expect(audit).toEqual([
      expect.objectContaining({
        action: "user.admin_create",
        actorId: null,
        reason: "CLI",
        tournamentId: null,
      }),
    ]);
    expect(JSON.stringify(audit.map((a) => [a.before, a.after, a.reason]))).not.toContain(r.oneTimePassword);
  });

  it("uses the given display name, and rejects invalid input without writing anything", async () => {
    expect(await createAdminAccount({ email: "a@example.ch", displayName: "  Peter R. " })).toMatchObject({
      status: "created",
      displayName: "Peter R.",
    });
    await expect(createAdminAccount({ email: "not-an-email" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createAdminAccount({ email: "b@example.ch", displayName: "X" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await db.user.count()).toBe(1);
  });

  it("never touches an existing account without promote", async () => {
    const player = await makeUser({ email: "player@example.ch" });
    const r = await createAdminAccount({ email: "PLAYER@example.ch" });
    expect(r).toMatchObject({ status: "exists", userId: player.id, role: "PLAYER", isActive: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: player.id } })).toEqual(player);
    expect(await auditOf(player.id)).toEqual([]);
  });

  it("promote: makes the account an admin, keeps its password and name, and signs it out", async () => {
    const referee = await makeUser({ email: "ref@example.ch", role: "REFEREE", passwordHash: "kept-hash" });
    const { token } = await createSession(referee.id, null);
    const r = await createAdminAccount({ email: "ref@example.ch", displayName: "Ignored", promote: true });
    expect(r).toMatchObject({ status: "promoted", previousRole: "REFEREE", reactivated: false });
    expect(await db.user.findUniqueOrThrow({ where: { id: referee.id } })).toMatchObject({
      role: "ADMIN",
      isActive: true,
      passwordHash: "kept-hash",
      displayName: referee.displayName,
      mustChangePassword: false,
    });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await auditOf(referee.id)).toEqual([
      expect.objectContaining({
        action: "user.role_change",
        actorId: null,
        reason: "CLI",
        before: { role: "REFEREE", isActive: true },
        after: { role: "ADMIN", isActive: true, sessionsRevoked: 1 },
      }),
    ]);
  });

  it("promote reactivates a deactivated account; an active admin stays untouched", async () => {
    const inactive = await makeUser({ email: "old@example.ch", role: "ADMIN" });
    await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    expect(await createAdminAccount({ email: "old@example.ch" })).toMatchObject({
      status: "exists",
      role: "ADMIN",
      isActive: false,
    });
    expect(await createAdminAccount({ email: "old@example.ch", promote: true })).toMatchObject({
      status: "promoted",
      previousRole: "ADMIN",
      reactivated: true,
    });
    expect((await auditOf(inactive.id)).map((a) => a.action)).toEqual(["user.activate"]);

    expect(await createAdminAccount({ email: "old@example.ch", promote: true })).toMatchObject({
      status: "already_admin",
    });
    expect(await auditOf(inactive.id)).toHaveLength(1);
  });
});

describe("pnpm admin:create", () => {
  const tsx = path.resolve("node_modules/.bin/tsx");
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(tsx, ["scripts/create-admin.ts", ...args], { env: process.env }, (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr });
      });
    });

  it("prints a working one-time password once and refuses an existing account without --promote", async () => {
    const created = await cli("--email", "boss@example.ch", "--name", "Peter R.");
    expect(created.code).toBe(0);
    expect(created.out).toContain('Created the admin account "Peter R." <boss@example.ch>');
    const password = created.out.match(/One-time password: (\S+)/)?.[1] ?? "";
    const boss = await db.user.findUniqueOrThrow({ where: { email: "boss@example.ch" } });
    expect(await verifyPassword(boss.passwordHash, password)).toBe(true);

    const again = await cli("--email", "boss@example.ch");
    expect(again).toMatchObject({ code: 0, out: expect.stringContaining("is already an admin") });
    expect(again.out).not.toContain("One-time password");

    await makeUser({ email: "player@example.ch" });
    const refused = await cli("--email", "player@example.ch");
    expect(refused).toMatchObject({ code: 1, out: expect.stringContaining("--promote") });
    expect((await db.user.findUniqueOrThrow({ where: { email: "player@example.ch" } })).role).toBe("PLAYER");

    const usage = await cli("player@example.ch");
    expect(usage).toMatchObject({ code: 1, out: expect.stringContaining("Usage: pnpm admin:create") });
  });
});
