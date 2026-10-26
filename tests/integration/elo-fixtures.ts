// Elo Mode fixtures: an event switched to ELO with players, and helpers that drive matches through
// the real services. assertEloInvariants checks the guarantees after every test.
import { expect } from "vitest";
import { db } from "@/server/db";
import { conservationError } from "@/server/domain/elo/replay";
import type { Side } from "@/server/domain/elo/types";
import { consentEloRoster, createEloMatch, startEloMatch } from "@/server/services/elo-matches";
import { verifyRatings } from "@/server/services/elo-ratings";
import { confirmEloResult, submitEloResult } from "@/server/services/elo-results";
import { setGameMode } from "@/server/services/game-mode";
import type { User } from "@/generated/prisma/client";
import { makeTournament, makeUser } from "./factories";
import { actorOf, idemKey } from "./match-fixtures";

export async function eloEvent(playerCount = 8) {
  const t = await makeTournament();
  const admin = await makeUser({ role: "ADMIN", displayName: "Admin" });
  const referee = await makeUser({ role: "REFEREE", displayName: "Schiri" });
  const players: User[] = [];
  for (let i = 1; i <= playerCount; i++) players.push(await makeUser({ displayName: `Spieler ${i}` }));
  const opts = { tournamentId: t.id };
  await setGameMode(actorOf(admin), { mode: "ELO" }, opts);
  const session = await db.eloSession.findFirstOrThrow({ where: { tournamentId: t.id } });
  const tables = await db.gameTable.findMany({ where: { tournamentId: t.id }, orderBy: { number: "asc" } });
  return { t, admin, referee, players, session, tables, opts };
}

export type EloFx = Awaited<ReturnType<typeof eloEvent>>;

export const ids = (users: readonly User[]) => users.map((u) => u.id);
export const matchRow = (id: string) => db.eloMatch.findUniqueOrThrow({ where: { id } });

/** Create (by sideA[0]); unless `consent: false`, sideB[0] confirms the roster. */
export async function draftMatch(
  fx: EloFx,
  sideA: User[],
  sideB: User[],
  o: { table?: number; rated?: boolean; consent?: boolean } = {},
) {
  const created = await createEloMatch(
    actorOf(sideA[0]),
    { tableId: fx.tables[o.table ?? 0].id, sideA: ids(sideA), sideB: ids(sideB), rated: o.rated ?? true },
    fx.opts,
  );
  if (o.consent !== false) {
    await consentEloRoster(actorOf(sideB[0]), { matchId: created.matchId, rosterHash: created.rosterHash });
  }
  return created;
}

/** Draft, consent and start: returns the running match id. */
export async function startedMatch(
  fx: EloFx,
  sideA: User[],
  sideB: User[],
  o: { table?: number; rated?: boolean } = {},
) {
  const { matchId } = await draftMatch(fx, sideA, sideB, o);
  const m = await matchRow(matchId);
  await startEloMatch(actorOf(sideA[0]), { matchId, expectedVersion: m.version });
  return matchId;
}

/** A full match: sideA[0] reports `winner`, sideB[0] confirms. */
export async function playEloMatch(
  fx: EloFx,
  sideA: User[],
  sideB: User[],
  winner: Side,
  o: { table?: number; rated?: boolean } = {},
) {
  const matchId = await startedMatch(fx, sideA, sideB, o);
  const m = await matchRow(matchId);
  const submitted = await submitEloResult(actorOf(sideA[0]), {
    matchId,
    expectedVersion: m.version,
    winnerSide: winner,
    endType: "REGULAR",
    idempotencyKey: idemKey(),
  });
  const confirmed = await confirmEloResult(actorOf(sideB[0]), {
    matchId,
    resultVersion: submitted.resultVersion,
    idempotencyKey: idemKey(),
  });
  return { matchId, confirmed };
}

export const ratingOf = async (sessionId: string, user: User) =>
  (await db.eloPlayerRating.findUnique({ where: { sessionId_userId: { sessionId, userId: user.id } } }))
    ?.rating ?? 100;

/**
 * Locks belong exactly to the players of live matches; one live match per table; the stored
 * projection equals a fresh replay; rating points are conserved; one active run.
 */
export async function assertEloInvariants(sessionId: string) {
  const live = await db.eloMatch.findMany({
    where: { sessionId, status: { in: ["DRAFT", "IN_PROGRESS"] } },
    include: { participants: true },
  });
  const locks = await db.eloActivePlayer.findMany({ where: { sessionId } });
  expect(locks.map((l) => `${l.userId}:${l.matchId}`).sort()).toEqual(
    live.flatMap((m) => m.participants.map((p) => `${p.userId}:${m.id}`)).sort(),
  );
  expect(new Set(live.map((m) => m.tableId)).size).toBe(live.length);
  const v = await verifyRatings(sessionId);
  expect(v.mismatchedUserIds).toEqual([]);
  expect(v.maxDeviation).toBe(0);
  expect(v.conservationError).toBeLessThan(1e-9);
  const players = await db.eloPlayerRating.findMany({ where: { sessionId } });
  expect(conservationError(players, 100)).toBeLessThan(1e-9);
  expect(await db.eloRatingRun.count({ where: { sessionId, supersededAt: null } })).toBe(1);
}
