import { db, type Db } from "@/server/db";
import type { Role } from "@/generated/prisma/enums";
import { hashPassword } from "@/server/auth/password";
import { oneTimePassword } from "@/server/auth/tokens";
import { fail } from "@/server/domain/errors";
import { displayNameSchema, emailSchema } from "@/lib/validation/auth";
import { writeAudit } from "./audit";

export const DEFAULT_TOURNAMENT_NAME = "PharmaPong";
export const DEFAULT_ADMIN_NAME = "Turnierleitung";

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
      displayName: DEFAULT_ADMIN_NAME,
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
        displayName: DEFAULT_ADMIN_NAME,
        passwordHash,
        role: "ADMIN",
        mustChangePassword: true,
      },
    ],
    skipDuplicates: true,
  });
  return { created: r.count === 1 };
}

type AdminAccount = { userId: string; email: string; displayName: string };

export type CreateAdminResult =
  | (AdminAccount & { status: "created"; oneTimePassword: string })
  | (AdminAccount & { status: "promoted"; previousRole: Role; reactivated: boolean })
  | (AdminAccount & { status: "already_admin" })
  | (AdminAccount & { status: "exists"; role: Role; isActive: boolean });

/**
 * `pnpm admin:create` (scripts/create-admin.ts, guide in docs/admin-accounts.md). A new address gets an
 * admin account with a generated one-time password that must be changed at first login. An existing account
 * becomes an admin only with `promote`: it keeps its password, is reactivated if needed and is signed out.
 * Never changes a password. Audited without an actor (shown as "System") and with the reason "CLI".
 */
export async function createAdminAccount(
  input: { email: string; displayName?: string; promote?: boolean },
  client: Db = db,
): Promise<CreateAdminResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) fail("VALIDATION", `Not a valid e-mail address: "${input.email}"`);
  const name = displayNameSchema.safeParse(input.displayName ?? DEFAULT_ADMIN_NAME);
  if (!name.success) fail("VALIDATION", "The display name needs 2 to 40 characters.");
  const address = email.data;
  const displayName = name.data;
  const password = oneTimePassword();
  const passwordHash = await hashPassword(password);

  // A plain transaction rather than withTx, so that the CLI can report the database's own error.
  return client.$transaction(async (tx): Promise<CreateAdminResult> => {
    const existing = await tx.user.findUnique({
      where: { email: address },
      select: { id: true, email: true, displayName: true, role: true, isActive: true },
    });
    if (!existing) {
      const user = await tx.user.create({
        data: { email: address, displayName, passwordHash, role: "ADMIN", mustChangePassword: true },
      });
      await writeAudit(tx, {
        action: "user.admin_create",
        entityType: "User",
        entityId: user.id,
        after: { role: "ADMIN", mustChangePassword: true },
        reason: "CLI",
      });
      return { status: "created", userId: user.id, email: address, displayName, oneTimePassword: password };
    }
    const account = { userId: existing.id, email: existing.email, displayName: existing.displayName };
    if (existing.role === "ADMIN" && existing.isActive) return { ...account, status: "already_admin" };
    if (!input.promote) {
      return { ...account, status: "exists", role: existing.role, isActive: existing.isActive };
    }
    await tx.user.update({ where: { id: existing.id }, data: { role: "ADMIN", isActive: true } });
    const revoked = await tx.session.deleteMany({ where: { userId: existing.id } });
    await writeAudit(tx, {
      action: existing.role === "ADMIN" ? "user.activate" : "user.role_change",
      entityType: "User",
      entityId: existing.id,
      before: { role: existing.role, isActive: existing.isActive },
      after: { role: "ADMIN", isActive: true, sessionsRevoked: revoked.count },
      reason: "CLI",
    });
    return { ...account, status: "promoted", previousRole: existing.role, reactivated: !existing.isActive };
  });
}
