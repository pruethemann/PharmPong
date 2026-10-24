// Database side of sessions (no Next.js imports, so tests and scripts can use it).
import { db, type Db } from "@/server/db";
import type { Role } from "@/generated/prisma/enums";
import { randomToken, sha256 } from "./tokens";

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
};

/** Authenticated principal passed to every service call. */
export type Actor = SessionUser;

export async function createSession(
  userId: string,
  userAgent: string | null,
  client: Db = db,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.session.create({
    data: { id: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  return { token, expiresAt };
}

/** Resolve a raw cookie token to its user. Role and active flag are read fresh every time. */
export async function validateSessionToken(
  token: string,
  client: Db = db,
): Promise<{ user: SessionUser; sessionId: string; needsRefresh: boolean } | null> {
  const id = sha256(token);
  const session = await client.session.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    await client.session.deleteMany({ where: { id } });
    return null;
  }
  const { isActive: _active, ...user } = session.user;
  return {
    user,
    sessionId: id,
    needsRefresh: Date.now() - session.lastUsedAt.getTime() > REFRESH_AFTER_MS,
  };
}

export async function refreshSession(sessionId: string, client: Db = db): Promise<Date> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.session.updateMany({ where: { id: sessionId }, data: { lastUsedAt: new Date(), expiresAt } });
  return expiresAt;
}

export async function deleteSessionByToken(token: string, client: Db = db): Promise<void> {
  await client.session.deleteMany({ where: { id: sha256(token) } });
}

/** Revoke all sessions of a user (password change/reset, deactivation, role change). */
export async function revokeUserSessions(
  userId: string,
  client: Db = db,
  exceptSessionId?: string,
): Promise<void> {
  await client.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}
