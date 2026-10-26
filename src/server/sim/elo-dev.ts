// Dev and simulation helpers for Elo Mode (scripts and tests only, never the app).
import { db, type Db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/auth/sessions";
import { randomToken } from "@/server/auth/tokens";
import { fail } from "@/server/domain/errors";

/**
 * Close every running Elo session before a dev scenario or simulation replaces the event. Live
 * matches are cancelled, open results voided and the player locks freed (they are global, so a
 * stale session would block the same players in the next event). History stays.
 */
export async function retireEloSessions(client: Db = db): Promise<number> {
  const sessions = await client.eloSession.findMany({
    where: { status: { not: "CLOSED" } },
    select: { id: true },
  });
  for (const { id } of sessions) {
    await client.eloMatch.updateMany({
      where: { sessionId: id, status: { in: ["DRAFT", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", pausedAt: null, cancelReason: "Dev-Szenario neu aufgesetzt" },
    });
    await client.eloMatch.updateMany({
      where: { sessionId: id, status: { in: ["AWAITING_CONFIRMATION", "DISPUTED"] } },
      data: { status: "VOIDED" },
    });
    await client.eloActivePlayer.deleteMany({ where: { sessionId: id } });
    await client.eloSession.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  }
  return sessions.length;
}

export const SIM_ELO_REFEREE_EMAIL = "sim-elo-schiri@pharmapong.test";
export const simEloEmail = (n: number) => `sim-elo-${String(n).padStart(2, "0")}@pharmapong.test`;

/**
 * Accounts for the Elo simulation: 24 guests and a referee. Created only when missing (never
 * promoted), with a random password and mustChangePassword, so they cannot be used to log in.
 */
export async function ensureSimEloUsers(client: Db = db): Promise<{ referee: Actor; players: Actor[] }> {
  const passwordHash = await hashPassword(randomToken(24));
  const wanted = [
    { email: SIM_ELO_REFEREE_EMAIL, displayName: "Sim-Schiri", role: "REFEREE" as const },
    ...Array.from({ length: 24 }, (_, i) => ({
      email: simEloEmail(i + 1),
      displayName: `Gast ${String(i + 1).padStart(2, "0")}`,
      role: "PLAYER" as const,
    })),
  ];
  await client.user.createMany({
    data: wanted.map((u) => ({ ...u, passwordHash, mustChangePassword: true })),
    skipDuplicates: true,
  });
  const rows = await client.user.findMany({ where: { email: { in: wanted.map((u) => u.email) } } });
  const byEmail = new Map(rows.map((u) => [u.email, u]));
  const actors = wanted.map((w) => {
    const u = byEmail.get(w.email)!;
    if (u.role !== w.role) fail("FORBIDDEN", `${w.email} existiert bereits mit einer anderen Rolle.`);
    // In-process actors, never login sessions.
    return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, mustChangePassword: false };
  });
  return { referee: actors[0], players: actors.slice(1) };
}
