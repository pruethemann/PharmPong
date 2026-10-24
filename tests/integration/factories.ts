import { db } from "@/server/db";
import { normalizeTeamName } from "@/lib/validation/team";
import type { Role } from "@/generated/prisma/enums";

let seq = 0;
const next = () => ++seq;

export async function makeTournament(
  data: Partial<{
    name: string;
    status: "DRAFT" | "REGISTRATION_OPEN" | "REGISTRATION_LOCKED" | "GROUP_STAGE" | "KNOCKOUT_STAGE";
  }> = {},
) {
  const t = await db.tournament.create({
    data: { name: data.name ?? "PharmaPong Test", status: data.status ?? "DRAFT" },
  });
  await db.gameTable.createMany({
    data: [
      { tournamentId: t.id, number: 1, name: "Tisch 1" },
      { tournamentId: t.id, number: 2, name: "Tisch 2" },
    ],
  });
  return t;
}

export async function makeUser(
  opts: Partial<{ email: string; displayName: string; role: Role; passwordHash: string }> = {},
) {
  const n = next();
  return db.user.create({
    data: {
      email: opts.email ?? `user${n}@test.local`,
      displayName: opts.displayName ?? `User ${n}`,
      passwordHash: opts.passwordHash ?? "x",
      role: opts.role ?? "PLAYER",
    },
  });
}

export async function makeTeam(tournamentId: string, memberIds: string[] = [], name?: string) {
  const n = next();
  const teamName = name ?? `Team ${n}`;
  const team = await db.team.create({
    data: {
      tournamentId,
      name: teamName,
      nameNormalized: normalizeTeamName(teamName),
      inviteCode: `INV${n.toString().padStart(5, "0")}`,
      createdById: memberIds[0] ?? "seed",
    },
  });
  for (const [i, userId] of memberIds.entries()) {
    await db.teamMember.create({ data: { tournamentId, teamId: team.id, userId, slot: i + 1 } });
  }
  return team;
}
