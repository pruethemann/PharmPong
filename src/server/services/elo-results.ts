// Elo match results (show and confirm). A participant submits the winner; a participant of the
// other side sees it and confirms (→ COMPLETED, ratings applied in the same transaction) or files
// an objection (→ DISPUTED, no Elo). Non-participating staff can decide at any point.
// Every request is idempotent (client key), version-checked and written as an immutable revision.
import type { Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { assertEloAction } from "@/server/domain/elo/permissions";
import { validateEloResult, type EloResultInput } from "@/server/domain/elo/result-rules";
import type { Side } from "@/server/domain/elo/types";
import type { EloSession, Prisma } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import {
  assertEloVersion,
  eloFacts,
  eloMatchSnapshot,
  eloMutationResult,
  eloViewer,
  foldEloPause,
  inEloMatchTx,
  releasePlayers,
  sideOfParticipant,
  writeEloEvent,
  writeEloMatch,
  writeResultRevision,
  type EloMutationResult,
  type EloOpts,
  type LoadedEloMatch,
} from "./elo-core";
import { applyConfirmedMatch } from "./elo-ratings";
import { hashRequest, runIdempotent } from "./idempotency";
import { assertReason } from "./matches";
import type { TxContext } from "./tx";

export type EloResultFields = EloResultInput;

export type EloRatingChangeView = { userId: string; side: Side; delta: number; ratingAfter: number };

export type EloResultMutation = EloMutationResult & {
  resultVersion: number;
  /** Set when the match became COMPLETED. */
  confirmed?: {
    sequence: number;
    rated: boolean;
    multiplier: number | null;
    effective: boolean;
    changes: EloRatingChangeView[];
  };
};

const withResult = (m: LoadedEloMatch): EloResultMutation => ({
  ...eloMutationResult(m),
  resultVersion: m.resultVersion,
});

function idem(
  tx: Tx,
  ctx: TxContext,
  swept: number,
  actor: Actor,
  scope: string,
  key: string,
  payload: unknown,
) {
  return <T>(fn: () => Promise<T>) =>
    runIdempotent(
      tx,
      {
        key,
        scope,
        userId: actor.id,
        requestHash: hashRequest(payload),
        // A replay changes nothing, unless this transaction also expired drafts.
        onReplay: () => {
          if (swept === 0) ctx.dirty = false;
        },
      },
      fn,
    );
}

function assertResultVersion(m: LoadedEloMatch, expected: number): void {
  if (m.resultVersion !== expected) {
    fail("STALE_VERSION", "Das gemeldete Resultat wurde inzwischen geändert. Bitte prüfe es erneut.", {
      expected,
      actual: m.resultVersion,
    });
  }
}

/** Next number of the authoritative confirmation sequence (under the event lock). */
async function takeSequence(tx: Tx, sessionId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    UPDATE "EloSession" SET "nextSequence" = "nextSequence" + 1, "updatedAt" = now()
    WHERE id = ${sessionId} RETURNING "nextSequence" - 1 AS seq`;
  return Number(rows[0].seq);
}

/** → COMPLETED: sequence number, immutable revision, ratings (same transaction). */
async function completeMatch(
  tx: Tx,
  ctx: TxContext,
  session: EloSession,
  match: LoadedEloMatch,
  actor: Actor,
  kind: "CONFIRMED" | "STAFF_FINAL" | "RESOLVED",
  data: Prisma.EloMatchUncheckedUpdateManyInput,
  reason: string | null = null,
): Promise<EloResultMutation> {
  const sequence = await takeSequence(tx, session.id);
  const updated = await writeEloMatch(tx, match, {
    ...data,
    status: "COMPLETED",
    confirmedSequence: sequence,
    confirmedAt: ctx.now,
    confirmedById: actor.id,
    resultVersion: { increment: 1 },
  });
  await writeResultRevision(tx, updated, kind, actor.id, { reason });
  const step = await applyConfirmedMatch(tx, session.id, match.id);
  const changes = step.effective
    ? step.result!.changes.map((c) => ({
        userId: c.userId,
        side: c.side,
        delta: c.delta,
        ratingAfter: c.ratingAfter,
      }))
    : [];
  await writeEloEvent(tx, {
    sessionId: session.id,
    matchId: match.id,
    type: "RESULT_CONFIRMED",
    actorId: actor.id,
    payload: {
      kind,
      sequence,
      winnerSide: updated.winnerSide,
      multiplier: step.rated ? step.multiplier : null,
      changes,
    },
  });
  return {
    ...withResult(updated),
    confirmed: {
      sequence,
      rated: step.rated,
      multiplier: step.rated ? step.multiplier : null,
      effective: step.effective,
      changes,
    },
  };
}

/**
 * A participant reports the result (IN_PROGRESS → AWAITING_CONFIRMATION). The clock stops and the
 * table and players are free for the next match at once. While the other side has not reacted,
 * the reporting side may amend its report.
 */
export async function submitEloResult(
  actor: Actor,
  input: EloResultFields & { matchId: string; expectedVersion: number; idempotencyKey: string },
  opts?: EloOpts,
): Promise<EloResultMutation> {
  assertRole(actor, "PLAYER");
  const { idempotencyKey, ...payload } = input;
  return inEloMatchTx(
    input.matchId,
    ({ tx, ctx, match, session, swept }) =>
      idem(
        tx,
        ctx,
        swept,
        actor,
        "elo.submit",
        idempotencyKey,
        payload,
      )(async () => {
        assertEloVersion(match, input.expectedVersion);
        const amending = match.status === "AWAITING_CONFIRMATION";
        assertEloAction(
          amending ? "amendResult" : "submitResult",
          eloFacts(match, ctx.now.getTime()),
          eloViewer(actor),
        );
        const result = validateEloResult(input);
        const side = sideOfParticipant(match, actor.id)!;
        const updated = await writeEloMatch(tx, match, {
          status: "AWAITING_CONFIRMATION",
          ...result,
          ...(amending ? {} : { ...foldEloPause(match, ctx.now), endedAt: ctx.now }),
          submittedById: actor.id,
          submittedSide: side,
          submittedAt: ctx.now,
          resultVersion: { increment: 1 },
        });
        if (!amending) await releasePlayers(tx, match.id);
        await writeResultRevision(tx, updated, amending ? "AMENDED" : "SUBMITTED", actor.id);
        await writeEloEvent(tx, {
          sessionId: session.id,
          matchId: match.id,
          type: amending ? "RESULT_AMENDED" : "RESULT_SUBMITTED",
          actorId: actor.id,
          payload: { ...result, side, resultVersion: updated.resultVersion },
        });
        return withResult(updated);
      }),
    opts,
  );
}

/** A participant of the other side confirms the shown result: COMPLETED, Elo applied. */
export async function confirmEloResult(
  actor: Actor,
  input: { matchId: string; resultVersion: number; idempotencyKey: string },
  opts?: EloOpts,
): Promise<EloResultMutation> {
  assertRole(actor, "PLAYER");
  const { idempotencyKey, ...payload } = input;
  return inEloMatchTx(
    input.matchId,
    ({ tx, ctx, match, session, swept }) =>
      idem(
        tx,
        ctx,
        swept,
        actor,
        "elo.confirm",
        idempotencyKey,
        payload,
      )(async () => {
        assertEloAction("confirmResult", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
        assertResultVersion(match, input.resultVersion);
        return completeMatch(tx, ctx, session, match, actor, "CONFIRMED", {});
      }),
    opts,
  );
}

/** A participant of the other side objects: DISPUTED, no Elo until staff decide. */
export async function disputeEloResult(
  actor: Actor,
  input: { matchId: string; resultVersion: number; note?: string; idempotencyKey: string },
  opts?: EloOpts,
): Promise<EloResultMutation> {
  assertRole(actor, "PLAYER");
  const { idempotencyKey, ...payload } = input;
  return inEloMatchTx(
    input.matchId,
    ({ tx, ctx, match, session, swept }) =>
      idem(
        tx,
        ctx,
        swept,
        actor,
        "elo.dispute",
        idempotencyKey,
        payload,
      )(async () => {
        assertEloAction("disputeResult", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
        assertResultVersion(match, input.resultVersion);
        const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 300) || null;
        const updated = await writeEloMatch(tx, match, {
          status: "DISPUTED",
          disputedById: actor.id,
          disputedAt: ctx.now,
          disputeNote: note,
          resultVersion: { increment: 1 },
        });
        await writeResultRevision(tx, updated, "DISPUTED", actor.id, { reason: note });
        await writeEloEvent(tx, {
          sessionId: session.id,
          matchId: match.id,
          type: "DISPUTED",
          actorId: actor.id,
          payload: { note },
        });
        await writeAudit(tx, {
          tournamentId: ctx.tournament.id,
          actorId: actor.id,
          action: "elo.match.dispute",
          entityType: "EloMatch",
          entityId: match.id,
          before: eloMatchSnapshot(match),
          after: eloMatchSnapshot(updated),
          reason: note,
        });
        return withResult(updated);
      }),
    opts,
  );
}

/**
 * Non-participating staff decide the result: from a running match, a pending report or a dispute
 * (a reason is required to resolve a dispute). The match is COMPLETED and rated at once.
 */
export async function staffFinalizeEloResult(
  actor: Actor,
  input: EloResultFields & {
    matchId: string;
    expectedVersion: number;
    reason?: string;
    idempotencyKey: string;
  },
  opts?: EloOpts,
): Promise<EloResultMutation> {
  assertRole(actor, "REFEREE");
  const { idempotencyKey, ...payload } = input;
  return inEloMatchTx(
    input.matchId,
    ({ tx, ctx, match, session, swept }) =>
      idem(
        tx,
        ctx,
        swept,
        actor,
        "elo.staffFinal",
        idempotencyKey,
        payload,
      )(async () => {
        assertEloVersion(match, input.expectedVersion);
        assertEloAction("staffFinalize", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
        const result = validateEloResult(input);
        const resolving = match.status === "DISPUTED";
        const reason = resolving ? assertReason(input.reason, 3) : input.reason?.trim().slice(0, 500) || null;
        const running = match.status === "IN_PROGRESS";
        if (running) await releasePlayers(tx, match.id);
        const out = await completeMatch(
          tx,
          ctx,
          session,
          match,
          actor,
          resolving ? "RESOLVED" : "STAFF_FINAL",
          { ...result, ...(running ? { ...foldEloPause(match, ctx.now), endedAt: ctx.now } : {}) },
          reason,
        );
        await writeAudit(tx, {
          tournamentId: ctx.tournament.id,
          actorId: actor.id,
          action: resolving ? "elo.match.resolve" : "elo.match.staff_final",
          entityType: "EloMatch",
          entityId: match.id,
          before: eloMatchSnapshot(match),
          after: { ...result, status: "COMPLETED", sequence: out.confirmed!.sequence },
          reason,
        });
        return out;
      }),
    opts,
  );
}

/** Staff annul a pending or disputed result: VOIDED, never rated, kept in the history. */
export async function voidEloResult(
  actor: Actor,
  input: { matchId: string; expectedVersion: number; reason: string },
  opts?: EloOpts,
): Promise<EloResultMutation> {
  assertRole(actor, "REFEREE");
  const reason = assertReason(input.reason, 3);
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("voidResult", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const updated = await writeEloMatch(tx, match, { status: "VOIDED", resultVersion: { increment: 1 } });
      await writeResultRevision(tx, updated, "VOIDED", actor.id, { reason });
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "VOIDED",
        actorId: actor.id,
        payload: { reason },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "elo.match.void_pending",
        entityType: "EloMatch",
        entityId: match.id,
        before: eloMatchSnapshot(match),
        after: eloMatchSnapshot(updated),
        reason,
      });
      return withResult(updated);
    },
    opts,
  );
}
