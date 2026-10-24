// Result workflow: propose (step 1) → confirm (step 2), reject, admin forfeit,
// and winner advancement in the same transaction as the confirmation.
import type { Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { assertMatchTransition } from "@/server/domain/match-state";
import { forfeitResult, validateResult } from "@/server/domain/result-rules";
import { assertTransition } from "@/server/domain/tournament-state";
import type { EndType, Match } from "@/generated/prisma/client";
import { writeAudit, writeMatchEvent } from "./audit";
import { hashRequest, runIdempotent } from "./idempotency";
import {
  assertNotOwnMatch,
  assertReason,
  assertVersion,
  foldPause,
  getLockedMatch,
  inMatchTx,
  matchSnapshot,
  releaseTeamLocks,
  writeMatch,
} from "./matches";
import { lockMatches } from "./state";
import type { TxContext, TxOptions } from "./tx";

export type ResultFields = {
  winnerTeamId: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: EndType;
};

export type Advancement = { teamId: string; toCode: string; slot: "HOME" | "AWAY"; nextReady: boolean };

export type ResultMutation = {
  matchId: string;
  status: Match["status"];
  version: number;
  resultRevision: number;
};

export type ConfirmOutcome = ResultMutation & {
  advanced: Advancement | null;
  championTeamId: string | null;
};

const resultOf = (m: Match) => ({
  winnerTeamId: m.winnerTeamId,
  homeCupsRemaining: m.homeCupsRemaining,
  awayCupsRemaining: m.awayCupsRemaining,
  endType: m.endType,
});

const mutation = (m: Match): ResultMutation => ({
  matchId: m.id,
  status: m.status,
  version: m.version,
  resultRevision: m.resultRevision,
});

/** Set the tournament champion and move it to COMPLETED (final decided). */
export async function crownChampion(tx: Tx, ctx: TxContext, actor: Actor, final: Match): Promise<string> {
  const winner = final.winnerTeamId!;
  const before = await tx.tournament.findUniqueOrThrow({
    where: { id: ctx.tournament.id },
    select: { status: true, championTeamId: true },
  });
  if (before.status !== "COMPLETED") assertTransition(before.status, "COMPLETED");
  await tx.tournament.update({
    where: { id: ctx.tournament.id },
    data: { championTeamId: winner, status: "COMPLETED" },
  });
  ctx.tournament.status = "COMPLETED";
  await writeMatchEvent(tx, {
    tournamentId: ctx.tournament.id,
    matchId: final.id,
    type: "CHAMPION",
    actorId: actor.id,
    payload: { teamId: winner },
  });
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId: actor.id,
    action: before.status === "COMPLETED" ? "tournament.champion_change" : "tournament.complete",
    entityType: "Tournament",
    entityId: ctx.tournament.id,
    before,
    after: { status: "COMPLETED", championTeamId: winner },
  });
  return winner;
}

/**
 * Move the winner of a decided knockout match into its next match (locked FOR
 * UPDATE). The next match becomes READY once both slots are filled during the
 * knockout stage. The final crowns the champion. Group matches never advance.
 */
export async function advanceWinner(
  tx: Tx,
  ctx: TxContext,
  actor: Actor,
  match: Match,
): Promise<{ advanced: Advancement | null; championTeamId: string | null }> {
  if (match.stage !== "KNOCKOUT" || !match.winnerTeamId) return { advanced: null, championTeamId: null };
  if (!match.nextMatchId || !match.nextSlot) {
    return { advanced: null, championTeamId: await crownChampion(tx, ctx, actor, match) };
  }
  await lockMatches(tx, [match.nextMatchId]);
  const next = await tx.match.findUniqueOrThrow({ where: { id: match.nextMatchId } });
  const field = match.nextSlot === "HOME" ? "homeTeamId" : "awayTeamId";
  const current = next[field];
  if (next.status !== "PENDING" && next.status !== "READY" && current !== match.winnerTeamId) {
    fail("DOWNSTREAM_STARTED", undefined, { affected: [next.code] });
  }
  const home = field === "homeTeamId" ? match.winnerTeamId : next.homeTeamId;
  const away = field === "awayTeamId" ? match.winnerTeamId : next.awayTeamId;
  const becomesReady =
    next.status === "PENDING" && !!home && !!away && ctx.tournament.status === "KNOCKOUT_STAGE";
  if (becomesReady) assertMatchTransition("PENDING", "READY");
  const updated =
    current === match.winnerTeamId && !becomesReady
      ? next
      : await writeMatch(tx, next, {
          [field]: match.winnerTeamId,
          ...(becomesReady ? { status: "READY" as const } : {}),
        });
  await writeMatchEvent(tx, {
    tournamentId: ctx.tournament.id,
    matchId: next.id,
    type: "ADVANCED",
    actorId: actor.id,
    payload: { teamId: match.winnerTeamId, toCode: next.code, slot: match.nextSlot, fromCode: match.code },
  });
  return {
    advanced: {
      teamId: match.winnerTeamId,
      toCode: next.code,
      slot: match.nextSlot,
      nextReady: updated.status === "READY",
    },
    championTeamId: null,
  };
}

// ─── Propose ───────────────────────────────────────────────────────────────

export type ProposeInput = ResultFields & {
  matchId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

/** Step 1: IN_PROGRESS → AWAITING_CONFIRMATION. Stops the clock. Idempotent. */
export async function proposeResult(
  actor: Actor,
  input: ProposeInput,
  opts?: TxOptions,
): Promise<ResultMutation> {
  assertRole(actor, "REFEREE");
  const { idempotencyKey, ...payload } = input;
  return inMatchTx(
    actor,
    input.matchId,
    (tx, ctx) =>
      runIdempotent(
        tx,
        {
          key: idempotencyKey,
          scope: "match.propose",
          userId: actor.id,
          requestHash: hashRequest(payload),
          onReplay: () => (ctx.dirty = false),
        },
        async () => {
          const match = await getLockedMatch(tx, ctx, input.matchId);
          assertVersion(match, input.expectedVersion);
          assertMatchTransition(match.status, "AWAITING_CONFIRMATION");
          await assertNotOwnMatch(tx, actor, match);
          const result = validateResult({
            homeTeamId: match.homeTeamId!,
            awayTeamId: match.awayTeamId!,
            winnerTeamId: input.winnerTeamId,
            homeCupsRemaining: input.homeCupsRemaining,
            awayCupsRemaining: input.awayCupsRemaining,
            endType: input.endType,
          });
          const updated = await writeMatch(tx, match, {
            status: "AWAITING_CONFIRMATION",
            ...result,
            ...foldPause(match, ctx.now),
            endedAt: ctx.now,
            proposedAt: ctx.now,
            proposedById: actor.id,
            confirmedAt: null,
            confirmedById: null,
            resultRevision: { increment: 1 },
          });
          await writeMatchEvent(tx, {
            tournamentId: ctx.tournament.id,
            matchId: match.id,
            type: "PROPOSED",
            actorId: actor.id,
            payload: { ...result, resultRevision: updated.resultRevision },
          });
          await writeAudit(tx, {
            tournamentId: ctx.tournament.id,
            actorId: actor.id,
            action: "match.propose",
            entityType: "Match",
            entityId: match.id,
            before: matchSnapshot(match),
            after: matchSnapshot(updated),
          });
          return mutation(updated);
        },
      ),
    opts,
  );
}

// ─── Reject ────────────────────────────────────────────────────────────────

/**
 * Clock fields when a proposal is rejected. Normally the clock continues where
 * it stopped: (now − endedAt) is added to pausedDurationMs. While the whole
 * tournament is paused (since P) the match must stay paused until
 * resumeTournament, which adds (resume − P) to every match whose pausedAt
 * equals P. So the match gets pausedAt = P and only (P − endedAt) now; together
 * that is exactly (resume − endedAt). (P − endedAt) is negative when the result
 * was proposed during the pause; the pause before the proposal was already
 * folded into pausedDurationMs then, so the sum stays correct.
 */
async function clockAfterReject(
  tx: Tx,
  ctx: TxContext,
  match: Match,
): Promise<{ pausedDurationMs: number; pausedAt?: Date }> {
  const endedMs = match.endedAt?.getTime() ?? ctx.now.getTime();
  if (ctx.tournament.isPaused) {
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: ctx.tournament.id },
      select: { pausedAt: true },
    });
    if (t.pausedAt) {
      return {
        pausedAt: t.pausedAt,
        pausedDurationMs: Math.max(0, match.pausedDurationMs + t.pausedAt.getTime() - endedMs),
      };
    }
  }
  return { pausedDurationMs: match.pausedDurationMs + Math.max(0, ctx.now.getTime() - endedMs) };
}

/** AWAITING_CONFIRMATION → IN_PROGRESS. The clock continues where it stopped. */
export async function rejectProposal(
  actor: Actor,
  input: { matchId: string; expectedVersion: number },
  opts?: TxOptions,
): Promise<ResultMutation> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      assertMatchTransition(match.status, "IN_PROGRESS");
      await assertNotOwnMatch(tx, actor, match);
      const clock = await clockAfterReject(tx, ctx, match);
      const updated = await writeMatch(tx, match, {
        status: "IN_PROGRESS",
        winnerTeamId: null,
        homeCupsRemaining: null,
        awayCupsRemaining: null,
        endType: null,
        proposedAt: null,
        proposedById: null,
        endedAt: null,
        ...clock,
      });
      if (clock.pausedAt) {
        await writeMatchEvent(tx, {
          tournamentId: ctx.tournament.id,
          matchId: match.id,
          type: "PAUSED",
          actorId: actor.id,
          payload: { cause: "TOURNAMENT", reason: "reject" },
        });
      }
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "REJECTED",
        actorId: actor.id,
        payload: { rejected: resultOf(match), resultRevision: match.resultRevision },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.reject",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: matchSnapshot(updated),
      });
      return mutation(updated);
    },
    opts,
  );
}

// ─── Confirm ───────────────────────────────────────────────────────────────

export type ConfirmInput = {
  matchId: string;
  expectedVersion: number;
  resultRevision: number;
  idempotencyKey: string;
};

/**
 * Step 2: AWAITING_CONFIRMATION → COMPLETED, only for the reviewed resultRevision.
 * Releases the teams and advances the winner in the same transaction. Idempotent.
 */
export async function confirmResult(
  actor: Actor,
  input: ConfirmInput,
  opts?: TxOptions,
): Promise<ConfirmOutcome> {
  assertRole(actor, "REFEREE");
  const { idempotencyKey, ...payload } = input;
  return inMatchTx(
    actor,
    input.matchId,
    (tx, ctx) =>
      runIdempotent(
        tx,
        {
          key: idempotencyKey,
          scope: "match.confirm",
          userId: actor.id,
          requestHash: hashRequest(payload),
          onReplay: () => (ctx.dirty = false),
        },
        async () => {
          const match = await getLockedMatch(tx, ctx, input.matchId);
          assertVersion(match, input.expectedVersion);
          if (match.resultRevision !== input.resultRevision) {
            fail("STALE_VERSION", undefined, { resultRevision: match.resultRevision });
          }
          assertMatchTransition(match.status, "COMPLETED");
          await assertNotOwnMatch(tx, actor, match);
          await releaseTeamLocks(tx, match.id);
          const updated = await writeMatch(tx, match, {
            status: "COMPLETED",
            confirmedAt: ctx.now,
            confirmedById: actor.id,
          });
          await writeMatchEvent(tx, {
            tournamentId: ctx.tournament.id,
            matchId: match.id,
            type: "CONFIRMED",
            actorId: actor.id,
            payload: { ...resultOf(updated), resultRevision: updated.resultRevision },
          });
          await writeAudit(tx, {
            tournamentId: ctx.tournament.id,
            actorId: actor.id,
            action: "match.confirm",
            entityType: "Match",
            entityId: match.id,
            before: matchSnapshot(match),
            after: matchSnapshot(updated),
          });
          const adv = await advanceWinner(tx, ctx, actor, updated);
          return { ...mutation(updated), ...adv };
        },
      ),
    opts,
  );
}

// ─── Forfeit ───────────────────────────────────────────────────────────────

export type ForfeitInput = {
  matchId: string;
  winnerTeamId: string;
  reason: string;
  expectedVersion?: number;
};

/** Admin: the present team wins 10:0. Advances exactly like a confirmation. */
export async function forfeitMatch(
  actor: Actor,
  input: ForfeitInput,
  opts?: TxOptions,
): Promise<ConfirmOutcome> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 3);
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      if (!["READY", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"].includes(match.status)) {
        fail("INVALID_STATE", "Forfait ist nur für nicht abgeschlossene Spiele mit beiden Teams möglich.");
      }
      assertMatchTransition(match.status, "FORFEITED");
      const result = forfeitResult(match.homeTeamId!, match.awayTeamId!, input.winnerTeamId);
      await releaseTeamLocks(tx, match.id);
      const updated = await writeMatch(tx, match, {
        status: "FORFEITED",
        ...result,
        ...(match.startedAt && !match.endedAt ? { ...foldPause(match, ctx.now), endedAt: ctx.now } : {}),
        proposedAt: null,
        proposedById: null,
        confirmedAt: ctx.now,
        confirmedById: actor.id,
        resultRevision: { increment: 1 },
      });
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "FORFEITED",
        actorId: actor.id,
        payload: { winnerTeamId: result.winnerTeamId, reason, from: match.status },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.forfeit",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: matchSnapshot(updated),
        reason,
      });
      const adv = await advanceWinner(tx, ctx, actor, updated);
      return { ...mutation(updated), ...adv };
    },
    opts,
  );
}
