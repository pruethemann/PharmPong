import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/server/env";
import { fail } from "@/server/domain/errors";
import type { Role } from "@/generated/prisma/enums";
import { refreshSession, validateSessionToken, type SessionUser } from "./sessions";

export const SESSION_COOKIE = "pp_session";

function secureCookies(): boolean {
  return env().APP_URL.startsWith("https://");
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

const loadSession = cache(async () => {
  const token = await readSessionToken();
  if (!token) return null;
  return validateSessionToken(token);
});

/** Current user for Server Components, Route Handlers and Server Actions (request-cached). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const s = await loadSession();
  return s?.user ?? null;
});

/**
 * Slide the session expiry. Only callable where cookies are writable
 * (Server Actions / Route Handlers), never in Server Components.
 */
export async function touchSession(): Promise<void> {
  const s = await loadSession();
  const token = await readSessionToken();
  if (s?.needsRefresh && token) {
    const expiresAt = await refreshSession(s.sessionId);
    await setSessionCookie(token, expiresAt);
  }
}

export async function currentSessionId(): Promise<string | null> {
  return (await loadSession())?.sessionId ?? null;
}

// ─── Guards ────────────────────────────────────────────────────────────────

const RANK: Record<Role, number> = { PLAYER: 0, REFEREE: 1, ADMIN: 2 };

export function hasRole(user: Pick<SessionUser, "role"> | null, min: Role): boolean {
  return !!user && RANK[user.role] >= RANK[min];
}

/** For pages/layouts: redirect to login when not signed in, 403 page when lacking role. */
export async function requirePageUser(min: Role = "PLAYER", returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`);
  if (user.mustChangePassword && returnTo !== "/profile") redirect("/profile?mustChange=1");
  if (!hasRole(user, min)) redirect("/?forbidden=1");
  return user;
}

/** For actions/route handlers: throw DomainErrors instead of redirecting. */
export async function requireUser(min: Role = "PLAYER"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) fail("UNAUTHENTICATED");
  if (!hasRole(user, min)) fail("FORBIDDEN");
  return user;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
