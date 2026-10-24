// Demo participants for local testing and rehearsals: 24 players in 12
// complete teams plus one referee. Idempotent and refused in production
// unless ALLOW_DEMO_SEED=true. Not imported by the app at runtime.
import type { Db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { inviteCode as newInviteCode } from "@/server/auth/tokens";
import { fail } from "@/server/domain/errors";
import { normalizeTeamName } from "@/lib/validation/team";
import { writeAudit } from "@/server/services/audit";
import { ensureTournament } from "@/server/services/bootstrap";
import { withTournamentTx } from "@/server/services/tx";

export const DEMO_EMAIL_DOMAIN = "pharmapong.test";
export const DEMO_REFEREE_EMAIL = `schiri@${DEMO_EMAIL_DOMAIN}`;
export const DEMO_PLAYER_COUNT = 24;

export const demoEmail = (n: number) => `demo${String(n).padStart(2, "0")}@${DEMO_EMAIL_DOMAIN}`;

const FIRST_NAMES = [
  "Lea",
  "Nico",
  "Mia",
  "Luca",
  "Anna",
  "Jonas",
  "Laura",
  "Reto",
  "Sara",
  "Fabian",
  "Nina",
  "Urs",
  "Selina",
  "Dominik",
  "Céline",
  "Matthias",
  "Lara",
  "Simon",
  "Jana",
  "Beat",
  "Chiara",
  "Yannick",
  "Noemi",
  "Michael",
];
const LAST_INITIALS = "BKMSWFHGRZLTAEPNVDCOJIUY";

export const DEMO_TEAMS: readonly { name: string; motto: string }[] = [
  { name: "Die Pipettierer", motto: "Präzise auf den Mikroliter." },
  { name: "Placebo-Effekt", motto: "Wir glauben fest an uns." },
  { name: "Zentrifugal-Kräfte", motto: "Wir drehen richtig auf." },
  { name: "Ibuprofans", motto: "Gegen jeden Schmerz – ausser Niederlagen." },
  { name: "Hydroxyl-Gruppe", motto: "Immer gut gebunden." },
  { name: "Titrations-Titanen", motto: "Bis zum Umschlagpunkt." },
  { name: "Enzym-Express", motto: "Wir senken jede Aktivierungsenergie." },
  { name: "Peptid-Piraten", motto: "Entern, falten, gewinnen." },
  { name: "Katalysator-Kids", motto: "Wir beschleunigen alles." },
  { name: "Molekül-Mafia", motto: "Ein Angebot, das ihr nicht ablehnen könnt." },
  { name: "Halbwertszeit", motto: "Nach 7.5 Minuten ist die Hälfte weg." },
  { name: "Bioverfügbar", motto: "100 % Einsatz, sofort wirksam." },
];

export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && env.ALLOW_DEMO_SEED !== "true") {
    fail(
      "FORBIDDEN",
      "Demo-Daten sind in Produktion deaktiviert (ALLOW_DEMO_SEED=true setzen, um zu erzwingen).",
    );
  }
}

export type DemoSeedResult = {
  created: boolean;
  tournamentId: string;
  users: number;
  teams: number;
  referees: number;
};

/**
 * Create 24 demo players (demo01…demo24@pharmapong.test), 12 complete teams and
 * one referee (schiri@pharmapong.test). Skips everything if demo users exist.
 * Leaves the tournament in REGISTRATION_OPEN (advancing from DRAFT).
 */
export async function createDemoParticipants(
  client: Db,
  opts: { tournamentId: string; password: string },
): Promise<DemoSeedResult> {
  assertDemoSeedAllowed();
  if (opts.password.length < 10) fail("VALIDATION", "Das Demo-Passwort braucht mindestens 10 Zeichen.");
  const existing = await client.user.count({
    where: { OR: [{ email: demoEmail(1) }, { email: DEMO_REFEREE_EMAIL }] },
  });
  if (existing > 0) {
    return { created: false, tournamentId: opts.tournamentId, users: 0, teams: 0, referees: 0 };
  }
  // One hash for all demo accounts (argon2 is deliberately slow).
  const passwordHash = await hashPassword(opts.password);
  const { tournamentId } = opts;

  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status === "DRAFT") {
        await tx.tournament.update({ where: { id: tournamentId }, data: { status: "REGISTRATION_OPEN" } });
      } else if (ctx.tournament.status !== "REGISTRATION_OPEN") {
        fail("INVALID_STATE", "Demo-Teams können nur vor dem Sperren der Anmeldung angelegt werden.");
      }

      const users = [];
      for (let i = 0; i < DEMO_PLAYER_COUNT; i++) {
        users.push(
          await tx.user.create({
            data: {
              email: demoEmail(i + 1),
              displayName: `${FIRST_NAMES[i]} ${LAST_INITIALS[i]}.`,
              passwordHash,
              role: "PLAYER",
            },
            select: { id: true },
          }),
        );
      }
      await tx.user.create({
        data: { email: DEMO_REFEREE_EMAIL, displayName: "Schiri Demo", passwordHash, role: "REFEREE" },
      });

      let teams = 0;
      for (const [i, t] of DEMO_TEAMS.entries()) {
        const [a, b] = [users[2 * i], users[2 * i + 1]];
        let code = newInviteCode();
        while (await tx.team.findUnique({ where: { inviteCode: code }, select: { id: true } })) {
          code = newInviteCode();
        }
        await tx.team.create({
          data: {
            tournamentId,
            name: t.name,
            nameNormalized: normalizeTeamName(t.name),
            motto: t.motto,
            inviteCode: code,
            createdById: a.id,
            members: {
              create: [
                { tournamentId, userId: a.id, slot: 1, isReady: true },
                { tournamentId, userId: b.id, slot: 2, isReady: true },
              ],
            },
          },
        });
        teams++;
      }
      await writeAudit(tx, {
        tournamentId,
        actorId: null,
        action: "demo.seed",
        entityType: "Tournament",
        entityId: tournamentId,
        after: { users: users.length, referees: 1, teams },
      });
      return { created: true, tournamentId, users: users.length, teams, referees: 1 };
    },
    { client },
  );
}

/** Ensure an open tournament exists, then seed the demo participants. */
export async function seedDemo(client: Db, opts: { password: string }): Promise<DemoSeedResult> {
  assertDemoSeedAllowed();
  const tournamentId = await ensureTournament(client);
  return createDemoParticipants(client, { tournamentId, password: opts.password });
}
