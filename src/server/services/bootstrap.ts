import { db, type Db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";

export const DEFAULT_TOURNAMENT_NAME = "PharmaPong";

/** Ensure an open tournament with two tables exists. Idempotent. */
export async function ensureTournament(client: Db = db): Promise<string> {
  const open = await client.tournament.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  if (open) return open.id;
  const t = await client.tournament.create({
    data: {
      name: DEFAULT_TOURNAMENT_NAME,
      tables: {
        create: [
          { number: 1, name: "Tisch 1" },
          { number: 2, name: "Tisch 2" },
        ],
      },
    },
  });
  return t.id;
}

/**
 * Pre-deploy variant of ensureTournament (scripts/seed-admin.ts). While the latest tournament runs
 * Elo Mode or still has a non-closed Elo session, it stays the current event instead of a fresh
 * tournament being opened: otherwise a hotfix deploy during the apéro after the competitive final
 * would hide the running Elo session.
 */
export async function ensureTournamentForDeploy(
  client: Db = db,
): Promise<{ tournamentId: string; keptEloEvent: boolean }> {
  const open = await client.tournament.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  if (open) return { tournamentId: open.id, keptEloEvent: false };
  const latest = await client.tournament.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      gameMode: true,
      eloSessions: { where: { status: { not: "CLOSED" } }, select: { id: true } },
    },
  });
  if (latest && (latest.gameMode === "ELO" || latest.eloSessions.length > 0)) {
    return { tournamentId: latest.id, keptEloEvent: true };
  }
  return { tournamentId: await ensureTournament(client), keptEloEvent: false };
}

/** Create the initial admin if missing. Never overwrites an existing account's password. */
export async function ensureAdmin(
  email: string,
  initialPassword: string,
  client: Db = db,
): Promise<{ created: boolean; promoted: boolean }> {
  const normalized = email.trim().toLowerCase();
  const existing = await client.user.findUnique({ where: { email: normalized } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      await client.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
      return { created: false, promoted: true };
    }
    return { created: false, promoted: false };
  }
  await client.user.create({
    data: {
      email: normalized,
      displayName: "Turnierleitung",
      passwordHash: await hashPassword(initialPassword),
      role: "ADMIN",
      mustChangePassword: true,
    },
  });
  return { created: true, promoted: false };
}

/**
 * Create an admin account only if the address is unused. Unlike ensureAdmin it
 * never promotes an existing account (for service accounts such as the
 * simulation admin, whose address someone could have self-registered).
 */
export async function createAdminIfMissing(
  email: string,
  initialPassword: string,
  client: Db = db,
): Promise<{ created: boolean }> {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(initialPassword);
  const r = await client.user.createMany({
    data: [
      {
        email: normalized,
        displayName: "Turnierleitung",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: true,
      },
    ],
    skipDuplicates: true,
  });
  return { created: r.count === 1 };
}
