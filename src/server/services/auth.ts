import { timingSafeEqual } from "node:crypto";
import { db, type Db } from "@/server/db";
import { fail } from "@/server/domain/errors";
import { hashPassword, verifyDummy, verifyPassword } from "@/server/auth/password";
import { createSession, revokeUserSessions, type Actor, type SessionUser } from "@/server/auth/sessions";
import { assertRole } from "@/server/auth/roles";
import { clear, hit, isLocked, RULES } from "@/server/auth/throttle";
import { randomToken, sha256 } from "@/server/auth/tokens";
import { writeAudit } from "./audit";
import { withTx } from "./tx";

const RESET_TTL_MS = 30 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Reserved for demo / simulation accounts; never available for self-registration. */
export const RESERVED_EMAIL_DOMAIN = "pharmapong.test";

export async function registerUser(
  input: { email: string; displayName: string; password: string; eventCode?: string },
  meta: { ip: string; userAgent: string | null; requiredEventCode?: string },
  client: Db = db,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const ipKey = `register:ip:${meta.ip}`;
  if (await isLocked(ipKey, client)) fail("RATE_LIMITED");
  await hit(ipKey, RULES.register, client);
  if (meta.requiredEventCode && !safeEqual((input.eventCode ?? "").trim(), meta.requiredEventCode)) {
    fail("VALIDATION", "Falscher Event-Code.", { field: "eventCode" });
  }
  if (input.email.trim().toLowerCase().endsWith(`@${RESERVED_EMAIL_DOMAIN}`)) {
    fail("VALIDATION", "Diese E-Mail-Adresse ist reserviert.", { field: "email" });
  }
  const passwordHash = await hashPassword(input.password);
  const user = await withTx(
    async (tx) => {
      const u = await tx.user.create({
        // Role is never taken from input: self-registration always creates a PLAYER.
        data: { email: input.email, displayName: input.displayName, passwordHash, role: "PLAYER" },
      });
      await writeAudit(tx, { actorId: u.id, action: "user.register", entityType: "User", entityId: u.id });
      return u;
    },
    { client },
  );
  const { token, expiresAt } = await createSession(user.id, meta.userAgent, client);
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: false,
    },
    token,
    expiresAt,
  };
}

export async function login(
  input: { email: string; password: string },
  meta: { ip: string; userAgent: string | null },
  client: Db = db,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const emailKey = `login:email:${input.email}`;
  const ipKey = `login:ip:${meta.ip}`;
  if ((await isLocked(emailKey, client)) || (await isLocked(ipKey, client))) fail("RATE_LIMITED");

  const user = await client.user.findUnique({ where: { email: input.email } });
  const ok = user
    ? await verifyPassword(user.passwordHash, input.password)
    : (await verifyDummy(input.password), false);

  if (!user || !ok || !user.isActive) {
    const [e] = await Promise.all([
      hit(emailKey, RULES.loginEmail, client),
      hit(ipKey, RULES.loginIp, client),
    ]);
    if (e.locked) fail("RATE_LIMITED");
    fail("INVALID_CREDENTIALS");
  }
  await clear(emailKey, client);
  const { token, expiresAt } = await createSession(user.id, meta.userAgent, client);
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
    token,
    expiresAt,
  };
}

export async function changePassword(
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
  currentSessionId: string | null,
  client: Db = db,
): Promise<void> {
  assertRole(actor, "PLAYER");
  const user = await client.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    fail("INVALID_CREDENTIALS", "Das aktuelle Passwort ist falsch.");
  }
  const passwordHash = await hashPassword(input.newPassword);
  await withTx(
    async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash, mustChangePassword: false } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.password_change",
        entityType: "User",
        entityId: actor.id,
      });
    },
    { client },
  );
  await revokeUserSessions(actor.id, client, currentSessionId ?? undefined);
}

export async function updateProfile(actor: Actor, input: { displayName: string }, client: Db = db) {
  assertRole(actor, "PLAYER");
  await withTx(
    async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { displayName: true },
      });
      await tx.user.update({ where: { id: actor.id }, data: { displayName: input.displayName } });
      if (before.displayName !== input.displayName) {
        // Live snapshots (cached per tournament revision) show member names:
        // bump the revision of every tournament this user plays in.
        await tx.$executeRaw`
          UPDATE "Tournament" SET revision = revision + 1, "updatedAt" = now()
          WHERE id IN (SELECT "tournamentId" FROM "TeamMember" WHERE "userId" = ${actor.id} AND "leftAt" IS NULL)`;
      }
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.profile_update",
        entityType: "User",
        entityId: actor.id,
        before,
        after: input,
      });
    },
    { client },
  );
}

/** Admin-controlled account recovery: one-time link, 30 min, single use. */
export async function createPasswordResetLink(
  actor: Actor,
  userId: string,
  client: Db = db,
): Promise<{ token: string; expiresAt: Date }> {
  assertRole(actor, "ADMIN");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await withTx(
    async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await tx.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordReset.create({
        data: { tokenHash: sha256(token), userId, createdById: actor.id, expiresAt },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.reset_link",
        entityType: "User",
        entityId: userId,
      });
    },
    { client },
  );
  return { token, expiresAt };
}

export async function redeemPasswordReset(
  input: { token: string; newPassword: string },
  meta: { ip: string },
  client: Db = db,
): Promise<void> {
  const ipKey = `reset:ip:${meta.ip}`;
  if (await isLocked(ipKey, client)) fail("RATE_LIMITED");
  const passwordHash = await hashPassword(input.newPassword);
  const userId = await withTx(
    async (tx) => {
      const reset = await tx.passwordReset.findUnique({ where: { tokenHash: sha256(input.token) } });
      if (!reset || reset.usedAt || reset.expiresAt < new Date()) return null;
      const used = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) return null;
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await writeAudit(tx, {
        actorId: reset.userId,
        action: "user.reset_redeem",
        entityType: "User",
        entityId: reset.userId,
      });
      return reset.userId;
    },
    { client },
  );
  if (!userId) {
    await hit(ipKey, RULES.reset, client);
    fail("NOT_FOUND", "Der Link ist ungültig oder abgelaufen.");
  }
  await revokeUserSessions(userId, client);
}
