// Elo Mode service helpers shared by elo-matches, elo-results, elo-corrections and elo-session.
//
// Concurrency: every Elo write runs in withTournamentTx (the tournament row is the event), so Elo
// writes, rating replays, mode switches and competitive writes are serialized. Each transaction
// first cancels expired drafts (lazy expiry, no cron), locks the match row, checks the client's
// expectedVersion and writes with `updateMany where {id, version}`. EloActivePlayer (PK userId)
// and the partial unique index elo_table_one_live_match are the final guards.
import { createHash } from "node:crypto";
import { db, type Db, type Tx } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { DRAFT_TTL_MINUTES } from "@/server/domain/elo/config";
import type { EloMatchFacts, EloViewer } from "@/server/domain/elo/permissions";
import { canonicalRoster } from "@/server/domain/elo/roster";
import { isDraftExpired } from "@/server/domain/elo/table-state";
import type { Side } from "@/server/domain/elo/types";
import type { EloMatch, EloMatchParticipant, EloSession, Prisma } from "@/generated/prisma/client";
import { stableJson } from "./idempotency";
import { getCurrentTournamentId, withTournamentTx, type TxContext, type TxOptions } from "./tx";

export type EloOpts = TxOptions & { tournamentId?: string };
export type LoadedEloMatch = EloMatch & { participants: EloMatchParticipant[] };
export type EloMutationResult = { matchId: string; version: number; status: EloMatch["status"] };

export const eloViewer = (actor: Actor): EloViewer => ({ userId: actor.id, role: actor.role });

/** Hash of exactly what both sides consent to: the sorted rosters and the rated flag. */
export function rosterHashOf(sideA: readonly string[], sideB: readonly string[], rated: boolean): string {
  return createHash("sha256")
    .update(stableJson(canonicalRoster(sideA, sideB, rated)))
    .digest("hex");
}

/** User ids per side in roster order. */
export function sidesOf(m: { participants: readonly EloMatchParticipant[] }): {
  sideA: string[];
  sideB: string[];
} {
  const ordered = [...m.participants].sort((a, b) => a.position - b.position);
  return {
    sideA: ordered.filter((p) => p.side === "A").map((p) => p.userId),
    sideB: ordered.filter((p) => p.side === "B").map((p) => p.userId),
  };
}

export const sideOfParticipant = (m: LoadedEloMatch, userId: string): Side | null =>
  m.participants.find((p) => p.userId === userId)?.side ?? null;

/** The permission facts of a match (input of the pure permission matrix). */
export function eloFacts(m: LoadedEloMatch, nowMs: number): EloMatchFacts {
  return {
    status: m.status,
    createdById: m.createdById,
    resultPolicy: m.resultPolicy,
    participants: m.participants.map((p) => ({ userId: p.userId, side: p.side })),
    consentA: m.consentAHash !== null && m.consentAHash === m.rosterHash,
    consentB: m.consentBHash !== null && m.consentBHash === m.rosterHash,
    paused: m.pausedAt !== null,
    submittedSide: m.submittedSide,
    expired: m.status === "DRAFT" && isDraftExpired(m.expiresAt?.getTime() ?? null, nowMs),
  };
}

export const draftExpiry = (now: Date): Date => new Date(now.getTime() + DRAFT_TTL_MINUTES * 60_000);

/** The non-closed session of the event, else the latest closed one (its final standings). */
export async function currentEloSession(client: Db | Tx, tournamentId: string): Promise<EloSession | null> {
  const open = await client.eloSession.findFirst({ where: { tournamentId, status: { not: "CLOSED" } } });
  return open ?? client.eloSession.findFirst({ where: { tournamentId }, orderBy: { createdAt: "desc" } });
}

export function assertSessionOpen(session: EloSession | null): asserts session is EloSession {
  if (!session)
    fail("SESSION_NOT_OPEN", "Es gibt noch keine Elo-Runde. Die Turnierleitung muss sie eröffnen.");
  if (session.status !== "OPEN") {
    fail(
      "SESSION_NOT_OPEN",
      session.status === "PAUSED"
        ? "Die Elo-Runde ist pausiert: Gerade starten keine neuen Matches."
        : "Die Elo-Runde ist beendet.",
    );
  }
}

/** Lazy expiry: cancel drafts whose reservation ran out and free their table and players. */
export async function sweepExpiredDrafts(tx: Tx, ctx: TxContext): Promise<number> {
  const expired = await tx.eloMatch.findMany({
    where: { status: "DRAFT", expiresAt: { lte: ctx.now }, session: { tournamentId: ctx.tournament.id } },
    select: { id: true, sessionId: true },
  });
  for (const m of expired) {
    await tx.eloMatch.update({
      where: { id: m.id },
      data: { status: "CANCELLED", cancelReason: "EXPIRED", version: { increment: 1 } },
    });
    await tx.eloActivePlayer.deleteMany({ where: { matchId: m.id } });
    await writeEloEvent(tx, { sessionId: m.sessionId, matchId: m.id, type: "EXPIRED" });
  }
  return expired.length;
}

export type EloTx = { tx: Tx; ctx: TxContext; session: EloSession | null; swept: number };

/** Event-level Elo transaction (current tournament unless opts.tournamentId). */
export async function withEloTx<T>(fn: (e: EloTx) => Promise<T>, opts: EloOpts = {}): Promise<T> {
  const tournamentId = opts.tournamentId ?? (await getCurrentTournamentId(opts.client ?? db));
  if (!tournamentId) fail("NOT_FOUND", "Kein Anlass gefunden.");
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      const swept = await sweepExpiredDrafts(tx, ctx);
      const session = await currentEloSession(tx, tournamentId);
      return fn({ tx, ctx, session, swept });
    },
    opts,
  );
}

export type EloMatchTx = {
  tx: Tx;
  ctx: TxContext;
  match: LoadedEloMatch;
  session: EloSession;
  swept: number;
};

/** Lock and load one Elo match (with its roster) inside the event transaction. */
export async function getLockedEloMatch(
  tx: Tx,
  ctx: TxContext,
  matchId: string,
): Promise<LoadedEloMatch & { session: EloSession }> {
  await tx.$queryRaw`SELECT id FROM "EloMatch" WHERE id = ${matchId} FOR UPDATE`;
  const m = await tx.eloMatch.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: [{ side: "asc" }, { position: "asc" }] }, session: true },
  });
  if (!m || m.session.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Match nicht gefunden.");
  return m;
}

/** Run `fn` for one match inside its event's transaction (expired drafts are swept first). */
export async function inEloMatchTx<T>(
  matchId: string,
  fn: (e: EloMatchTx) => Promise<T>,
  opts: EloOpts = {},
): Promise<T> {
  const row = await (opts.client ?? db).eloMatch.findUnique({
    where: { id: matchId },
    select: { session: { select: { tournamentId: true } } },
  });
  if (!row) fail("NOT_FOUND", "Match nicht gefunden.");
  return withTournamentTx(
    row.session.tournamentId,
    async (tx, ctx) => {
      const swept = await sweepExpiredDrafts(tx, ctx);
      const { session, ...match } = await getLockedEloMatch(tx, ctx, matchId);
      return fn({ tx, ctx, match, session, swept });
    },
    opts,
  );
}

export function assertEloVersion(m: EloMatch, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && m.version !== expectedVersion) {
    fail("STALE_VERSION", undefined, { expected: expectedVersion, actual: m.version });
  }
}

/** Optimistic write: applies only while the row still has `m.version`; increments the version. */
export async function writeEloMatch(
  tx: Tx,
  m: EloMatch,
  data: Prisma.EloMatchUncheckedUpdateManyInput,
): Promise<LoadedEloMatch> {
  const r = await tx.eloMatch.updateMany({
    where: { id: m.id, version: m.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (r.count !== 1) fail("STALE_VERSION");
  return tx.eloMatch.findUniqueOrThrow({
    where: { id: m.id },
    include: { participants: { orderBy: [{ side: "asc" }, { position: "asc" }] } },
  });
}

/** Lock the players of a live match; PLAYER_BUSY (with names) if one is in another live match. */
export async function lockPlayers(
  tx: Tx,
  sessionId: string,
  matchId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const busy = await tx.eloActivePlayer.findMany({
    where: { userId: { in: [...userIds] }, matchId: { not: matchId } },
    select: { userId: true },
  });
  if (busy.length > 0) {
    const names = await tx.user.findMany({
      where: { id: { in: busy.map((b) => b.userId) } },
      select: { displayName: true },
    });
    fail("PLAYER_BUSY", `${names.map((n) => n.displayName).join(", ")} spielt gerade ein anderes Match.`, {
      userIds: busy.map((b) => b.userId),
    });
  }
  // The primary key on userId is the final guard against a concurrent second match.
  await tx.eloActivePlayer.createMany({ data: userIds.map((userId) => ({ userId, matchId, sessionId })) });
}

export async function releasePlayers(tx: Tx, matchId: string, userIds?: readonly string[]): Promise<void> {
  await tx.eloActivePlayer.deleteMany({
    where: { matchId, ...(userIds ? { userId: { in: [...userIds] } } : {}) },
  });
}

export async function writeEloEvent(
  tx: Tx,
  e: {
    sessionId: string;
    matchId: string;
    type: string;
    actorId?: string | null;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.eloMatchEvent.create({
    data: {
      sessionId: e.sessionId,
      matchId: e.matchId,
      type: e.type,
      actorId: e.actorId ?? null,
      payload: e.payload,
    },
  });
}

/** Immutable result history: one row per result-defining step, numbered by resultVersion. */
export async function writeResultRevision(
  tx: Tx,
  m: LoadedEloMatch,
  kind: string,
  actorId: string | null,
  extra: { reason?: string | null; previous?: Prisma.InputJsonValue } = {},
): Promise<void> {
  const { sideA, sideB } = sidesOf(m);
  await tx.eloMatchResultRevision.create({
    data: {
      matchId: m.id,
      revision: m.resultVersion,
      kind,
      status: m.status,
      winnerSide: m.winnerSide,
      rated: m.rated,
      endType: m.endType,
      cupsRemainingA: m.cupsRemainingA,
      cupsRemainingB: m.cupsRemainingB,
      sideA,
      sideB,
      actorId,
      reason: extra.reason ?? null,
      previous: extra.previous,
    },
  });
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** JSON-safe snapshot of an Elo match for audit before/after. */
export function eloMatchSnapshot(m: LoadedEloMatch) {
  return {
    status: m.status,
    rated: m.rated,
    tableId: m.tableId,
    ...sidesOf(m),
    rosterHash: m.rosterHash,
    consentA: m.consentAHash === m.rosterHash ? m.consentAMethod : null,
    consentB: m.consentBHash === m.rosterHash ? m.consentBMethod : null,
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    pausedDurationMs: m.pausedDurationMs,
    winnerSide: m.winnerSide,
    endType: m.endType,
    cupsRemainingA: m.cupsRemainingA,
    cupsRemainingB: m.cupsRemainingB,
    submittedSide: m.submittedSide,
    resultVersion: m.resultVersion,
    confirmedSequence: m.confirmedSequence,
    ratingMultiplier: m.ratingMultiplier,
    version: m.version,
  };
}

export const eloMutationResult = (m: EloMatch): EloMutationResult => ({
  matchId: m.id,
  version: m.version,
  status: m.status,
});

/** Fold a running pause into pausedDurationMs (before ending the clock). */
export function foldEloPause(m: EloMatch, now: Date): { pausedAt: null; pausedDurationMs: number } {
  const extra = m.pausedAt ? Math.max(0, now.getTime() - m.pausedAt.getTime()) : 0;
  return { pausedAt: null, pausedDurationMs: m.pausedDurationMs + extra };
}
