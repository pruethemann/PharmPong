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
