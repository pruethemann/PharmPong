// Admin user management. Every function is ADMIN-only (defense in depth on top of
// the Server Action guard) and audited.
import { db } from "@/server/db";
import { fail } from "@/server/domain/errors";
import type { Role } from "@/generated/prisma/enums";
import type { Actor } from "@/server/auth/sessions";
import { assertRole } from "@/server/auth/roles";
import { emailSchema } from "@/lib/validation/auth";
import { createPasswordResetLink } from "./auth";
import { writeAudit } from "./audit";
import { getCurrentTournamentId, withTx } from "./tx";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  team: { id: string; name: string } | null;
};

export async function listUsers(actor: Actor, opts: { query?: string } = {}): Promise<AdminUserRow[]> {
  assertRole(actor, "ADMIN");
  const q = opts.query?.trim();
  const tournamentId = await getCurrentTournamentId();
  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ role: "desc" }, { displayName: "asc" }],
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
      memberships: {
        where: { leftAt: null, ...(tournamentId ? { tournamentId } : {}) },
        orderBy: { joinedAt: "desc" },
        take: 1,
        select: { team: { select: { id: true, name: true } } },
      },
    },
  });
  return users.map(({ memberships, ...u }) => ({ ...u, team: memberships[0]?.team ?? null }));
}

/**
 * Change a user's role. The last active admin can never be demoted.
 * Roles are read fresh on every request; additionally every role change revokes
 * the target's sessions (defense in depth), so they log in again with the new role.
 */
export async function setRole(
  actor: Actor,
  userId: string,
  role: Role,
): Promise<{ id: string; role: Role; changed: boolean }> {
  assertRole(actor, "ADMIN");
  return withTx(async (tx) => {
    // Lock all active admins so two concurrent demotions cannot both pass the "last admin" check.
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE role = 'ADMIN' AND "isActive" = true ORDER BY id FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) fail("NOT_FOUND", "Benutzer nicht gefunden.");
    if (target.role === role) return { id: target.id, role, changed: false };
    if (target.role === "ADMIN" && target.isActive && admins.length <= 1) {
      fail("INVALID_STATE", "Die letzte Admin-Person kann nicht herabgestuft werden.");
    }
    await tx.user.update({ where: { id: userId }, data: { role } });
    const revoked = await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.role_change",
      entityType: "User",
      entityId: userId,
      before: { role: target.role },
      after: { role, sessionsRevoked: revoked.count },
    });
    return { id: target.id, role, changed: true };
  });
}

/** Activate or deactivate an account. Self-deactivation is forbidden; deactivation revokes sessions. */
export async function setActive(
  actor: Actor,
  userId: string,
  isActive: boolean,
): Promise<{ id: string; isActive: boolean; changed: boolean }> {
  assertRole(actor, "ADMIN");
  if (!isActive && userId === actor.id) {
    fail("INVALID_STATE", "Du kannst dein eigenes Konto nicht deaktivieren.");
  }
  return withTx(async (tx) => {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE role = 'ADMIN' AND "isActive" = true ORDER BY id FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) fail("NOT_FOUND", "Benutzer nicht gefunden.");
    if (target.isActive === isActive) return { id: target.id, isActive, changed: false };
    if (!isActive && target.role === "ADMIN" && admins.length <= 1) {
      fail("INVALID_STATE", "Die letzte Admin-Person kann nicht deaktiviert werden.");
    }
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: isActive ? "user.activate" : "user.deactivate",
      entityType: "User",
      entityId: userId,
      before: { isActive: target.isActive },
      after: { isActive },
    });
    return { id: target.id, isActive, changed: true };
  });
}

/** One-time password reset link (30 min). Invalidates earlier unused links of the user. */
export async function createResetLink(
  actor: Actor,
  userId: string,
): Promise<{ url: string; expiresAt: Date }> {
  assertRole(actor, "ADMIN");
  const { token, expiresAt } = await createPasswordResetLink(actor, userId);
  const { env } = await import("@/server/env");
  const base = env().APP_URL.replace(/\/+$/, "");
  return { url: `${base}/reset/${token}`, expiresAt };
}

/**
 * Clear login throttling: all keys (no email), or exactly the login lock of one email
 * (`login:email:<email>`). No substring matching, so a partial input cannot unlock others.
 */
export async function unlockLogin(actor: Actor, email?: string): Promise<{ cleared: number }> {
  assertRole(actor, "ADMIN");
  let needle: string | undefined;
  if (email !== undefined && email.trim() !== "") {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      fail("VALIDATION", "Bitte gib eine gültige E-Mail-Adresse ein.", { field: "email" });
    }
    needle = parsed.data;
  }
  return withTx(async (tx) => {
    const r = await tx.authThrottle.deleteMany({
      where: needle ? { key: `login:email:${needle}` } : {},
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "auth.unlock",
      entityType: "AuthThrottle",
      entityId: needle ?? "*",
      after: { cleared: r.count },
    });
    return { cleared: r.count };
  });
}

export async function getUserCounts(
  actor: Actor,
): Promise<{ players: number; referees: number; admins: number; inactive: number }> {
  assertRole(actor, "ADMIN");
  const [grouped, inactive] = await Promise.all([
    db.user.groupBy({ by: ["role"], where: { isActive: true }, _count: { _all: true } }),
    db.user.count({ where: { isActive: false } }),
  ]);
  const count = (r: Role) => grouped.find((g) => g.role === r)?._count._all ?? 0;
  return { players: count("PLAYER"), referees: count("REFEREE"), admins: count("ADMIN"), inactive };
}
