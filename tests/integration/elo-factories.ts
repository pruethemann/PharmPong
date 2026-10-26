// Raw Elo rows for constraint and service tests (bypasses the services on purpose).
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

export async function makeEloSession(
  tournamentId: string,
  data: Partial<Prisma.EloSessionUncheckedCreateInput> = {},
) {
  const session = await db.eloSession.create({ data: { tournamentId, name: "Social Elo", ...data } });
  await db.eloRatingRun.create({
    data: {
      sessionId: session.id,
      revision: 1,
      reason: "INITIAL",
      algorithmVersion: "pharmaelo-v1",
      initialRating: 100,
      kFactor: 24,
      ratingScale: 100,
      repeatMultipliers: [1, 1, 0.5, 0],
      runtime: process.version,
    },
  });
  return session;
}

export function makeEloMatch(
  sessionId: string,
  tableId: string,
  createdById: string,
  data: Partial<Prisma.EloMatchUncheckedCreateInput> = {},
) {
  return db.eloMatch.create({
    data: {
      sessionId,
      tableId,
      createdById,
      resultPolicy: "DUAL_TEAM_CONFIRMATION",
      rosterHash: "roster-1",
      ...data,
    },
  });
}

/** Columns that make a match a valid started match (consents match the roster). */
export const STARTED = {
  status: "IN_PROGRESS",
  consentAHash: "roster-1",
  consentBHash: "roster-1",
  startedAt: new Date(),
} as const;
