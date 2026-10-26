// Rating persistence for Elo Mode. The ratings of a session are a pure function of its COMPLETED
// matches in confirmation order (domain/elo/replay.ts); this module loads that history, runs the
// replay and persists the result. Always called inside the event transaction (row lock), so a
// replay can never interleave with a confirmation.
//
//   confirmation  → replay history + the new match, append its rows to the active run
//   correction    → replay everything into a NEW run, supersede the old one (kept as history)
import { db, type Db, type Tx } from "@/server/db";
import { fail } from "@/server/domain/errors";
import { ELO_ALGORITHM_VERSION, validateEloParams } from "@/server/domain/elo/config";
import {
  compareProjections,
  conservationError,
  projectionDigest,
  projectionsOf,
  replaySession,
  type PlayerProjection,
  type ReplayEntry,
  type ReplayStep,
} from "@/server/domain/elo/replay";
import type { EloParams } from "@/server/domain/elo/types";
import type { EloRatingRun, Prisma } from "@/generated/prisma/client";
import type { TxContext } from "./tx";

export async function activeRun(client: Db | Tx, sessionId: string): Promise<EloRatingRun> {
  const run = await client.eloRatingRun.findFirst({ where: { sessionId, supersededAt: null } });
  if (!run) fail("INTERNAL", "Die Elo-Runde hat keine aktive Berechnung.");
  return run;
}

export const paramsOfRun = (run: EloRatingRun): EloParams => ({
  initialRating: run.initialRating,
  kFactor: run.kFactor,
  ratingScale: run.ratingScale,
  repeatMultipliers: run.repeatMultipliers,
});

/** COMPLETED matches (rated and friendly) with their current rosters, in confirmation order. */
export async function loadReplayEntries(client: Db | Tx, sessionId: string): Promise<ReplayEntry[]> {
  const rows = await client.eloMatch.findMany({
    where: { sessionId, status: "COMPLETED" },
    orderBy: { confirmedSequence: "asc" },
    select: {
      id: true,
      confirmedSequence: true,
      rated: true,
      winnerSide: true,
      participants: { select: { userId: true, side: true, position: true }, orderBy: { position: "asc" } },
    },
  });
  return rows.map((m) => ({
    matchId: m.id,
    sequence: m.confirmedSequence!,
    rated: m.rated,
    winner: m.winnerSide!,
    sideA: m.participants.filter((p) => p.side === "A").map((p) => p.userId),
    sideB: m.participants.filter((p) => p.side === "B").map((p) => p.userId),
  }));
}

function changeRows(
  run: EloRatingRun,
  steps: readonly ReplayStep[],
): Prisma.EloRatingChangeCreateManyInput[] {
  return steps.flatMap((s) =>
    s.effective && s.result
      ? s.result.changes.map((c) => ({
          runId: run.id,
          runRevision: run.revision,
          matchId: s.matchId,
          userId: c.userId,
          side: c.side,
          sequence: s.sequence,
          ratingBefore: c.ratingBefore,
          delta: c.delta,
          ratingAfter: c.ratingAfter,
          expectedScore: c.expectedScore,
          teamSize: c.teamSize,
          opponentTeamSize: c.opponentTeamSize,
          multiplier: s.multiplier,
          algorithmVersion: s.result!.algorithmVersion,
        }))
      : [],
  );
}

const projectionData = (sessionId: string, p: PlayerProjection) => ({
  sessionId,
  userId: p.userId,
  rating: p.rating,
  gamesPlayed: p.gamesPlayed,
  wins: p.wins,
  losses: p.losses,
  lowestRating: p.lowestRating,
  peakRating: p.peakRating,
  lastSequence: p.lastSequence,
});

/** Rating bookkeeping stored on the match (shown in history and used for achievements). */
const bookkeeping = (s: ReplayStep) => ({
  pairKey: s.pairKey,
  ratingMultiplier: s.rated ? s.multiplier : null,
  expectedScoreA: s.result?.expectedA ?? null,
});

/**
 * Apply a just-COMPLETED match (it already carries the next sequence number): replay the history
 * plus this match and persist only its step. Returns the step (changes for the celebration).
 */
export async function applyConfirmedMatch(tx: Tx, sessionId: string, matchId: string): Promise<ReplayStep> {
  const run = await activeRun(tx, sessionId);
  const { state, steps } = replaySession(await loadReplayEntries(tx, sessionId), paramsOfRun(run));
  const step = steps[steps.length - 1];
  if (!step || step.matchId !== matchId) {
    fail("INTERNAL", "Das bestätigte Match ist nicht das letzte der Bestätigungsreihenfolge.");
  }
  await tx.eloMatch.update({ where: { id: matchId }, data: bookkeeping(step) });
  if (step.effective) {
    await tx.eloRatingChange.createMany({ data: changeRows(run, [step]) });
    for (const userId of [...step.sideA, ...step.sideB]) {
      const p = state.players.get(userId)!;
      await tx.eloPlayerRating.upsert({
        where: { sessionId_userId: { sessionId, userId } },
        create: projectionData(sessionId, p),
        update: projectionData(sessionId, p),
      });
    }
  }
  return step;
}

export type RebuildReason =
  "CONFIG_CHANGE" | "CORRECTION" | "VOID" | "ROSTER_CORRECTION" | "RATED_CHANGED" | "MANUAL";

export type RebuildResult = {
  run: EloRatingRun;
  steps: ReplayStep[];
  digest: string;
  /** Digest of the stored projection just before the rebuild (equal = the replay reproduced it). */
  previousDigest: string;
  players: number;
};

/** Exact digest of the persisted projection (same format as projectionDigest of a replay). */
export async function storedProjectionDigest(client: Db | Tx, sessionId: string): Promise<string> {
  const rows = await client.eloPlayerRating.findMany({ where: { sessionId } });
  return projectionDigest({
    players: new Map(rows.map((r) => [r.userId, r])),
    pairCounts: new Map(),
    lastSequence: 0,
  });
}

/**
 * Full deterministic replay into a new calculation run (corrections, voids, parameter changes,
 * manual recalculation). The old run and its rows stay as history; the projection is rebuilt.
 */
export async function rebuildRatings(
  tx: Tx,
  ctx: TxContext,
  sessionId: string,
  opts: { reason: RebuildReason; actorId: string | null; note?: string | null; params?: EloParams },
): Promise<RebuildResult> {
  const old = await activeRun(tx, sessionId);
  const params = validateEloParams(opts.params ?? paramsOfRun(old));
  const { state, steps } = replaySession(await loadReplayEntries(tx, sessionId), params);
  const digest = projectionDigest(state);
  const previousDigest = await storedProjectionDigest(tx, sessionId);
  // Supersede first: the partial unique index allows exactly one active run per session.
  await tx.eloRatingRun.update({ where: { id: old.id }, data: { supersededAt: ctx.now } });
  const run = await tx.eloRatingRun.create({
    data: {
      sessionId,
      revision: old.revision + 1,
      reason: opts.reason,
      triggeredById: opts.actorId,
      note: opts.note ?? null,
      algorithmVersion: ELO_ALGORITHM_VERSION,
      initialRating: params.initialRating,
      kFactor: params.kFactor,
      ratingScale: params.ratingScale,
      repeatMultipliers: [...params.repeatMultipliers],
      runtime: process.version,
      digestAtCreation: digest,
    },
  });
  const rows = changeRows(run, steps);
  if (rows.length) await tx.eloRatingChange.createMany({ data: rows });
  const players = projectionsOf(state);
  await tx.eloPlayerRating.deleteMany({ where: { sessionId } });
  if (players.length)
    await tx.eloPlayerRating.createMany({ data: players.map((p) => projectionData(sessionId, p)) });
  for (const s of steps) await tx.eloMatch.update({ where: { id: s.matchId }, data: bookkeeping(s) });
  return { run, steps, digest, previousDigest, players: players.length };
}

export type RatingVerification = {
  runRevision: number;
  matches: number;
  players: number;
  maxDeviation: number;
  mismatchedUserIds: string[];
  conservationError: number;
  digest: string;
};

/** Read-only dry run: replay the session and compare with the stored projection ("Prüfen"). */
export async function verifyRatings(sessionId: string, client: Db = db): Promise<RatingVerification> {
  const run = await activeRun(client, sessionId);
  const params = paramsOfRun(run);
  const entries = await loadReplayEntries(client, sessionId);
  const { state } = replaySession(entries, params);
  const stored = await client.eloPlayerRating.findMany({ where: { sessionId }, orderBy: { userId: "asc" } });
  const replayed = projectionsOf(state);
  const cmp = compareProjections(stored, replayed);
  return {
    runRevision: run.revision,
    matches: entries.length,
    players: replayed.length,
    maxDeviation: cmp.maxDeviation,
    mismatchedUserIds: cmp.mismatchedUserIds,
    conservationError: conservationError(replayed, params.initialRating),
    digest: projectionDigest(state),
  };
}
