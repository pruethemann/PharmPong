// Admin corrections of COMPLETED Elo matches (winner, cups, end type, rated flag, roster) and
// voiding. A correction writes an immutable revision and replays the whole session into a new
// calculation run: every later match may have depended on the corrected ratings.
//
// The consent record (rosterHash / consent hashes) keeps describing what both sides agreed to before
// the start; a roster correction is documented in the revision history and the audit log.
import type { Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { assertEloAction } from "@/server/domain/elo/permissions";
import { validateEloResult, type EloResultInput } from "@/server/domain/elo/result-rules";
import { assertValidRoster } from "@/server/domain/elo/roster";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import {
  assertEloVersion,
  eloFacts,
  eloMatchSnapshot,
  eloMutationResult,
  eloViewer,
  inEloMatchTx,
  sidesOf,
  writeEloEvent,
  writeEloMatch,
  writeResultRevision,
  type EloMutationResult,
  type EloOpts,
} from "./elo-core";
import { rebuildRatings, type RebuildReason } from "./elo-ratings";
import { hashRequest, runIdempotent } from "./idempotency";
import { assertReason } from "./matches";

export type EloCorrection = Partial<EloResultInput> & {
  rated?: boolean;
  sideA?: string[];
  sideB?: string[];
};

export type EloCorrectionResult = EloMutationResult & { resultVersion: number; runRevision: number };

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

async function assertKnownPlayers(tx: Tx, userIds: readonly string[]): Promise<void> {
  const found = await tx.user.count({ where: { id: { in: [...userIds] } } });
  if (found !== new Set(userIds).size)
    fail("VALIDATION", "Unbekannte Spieler:in in der Aufstellung.", { field: "roster" });
}

/** Correct a completed match and replay the session (ADMIN, reason ≥ 5 characters, idempotent). */
export async function correctEloMatch(
  actor: Actor,
  input: {
    matchId: string;
    expectedVersion: number;
    resultVersion: number;
    changes: EloCorrection;
    reason: string;
    idempotencyKey: string;
  },
  opts?: EloOpts,
): Promise<EloCorrectionResult> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 5);
  const { idempotencyKey, ...payload } = input;
  return inEloMatchTx(
    input.matchId,
    ({ tx, ctx, match, session, swept }) =>
      runIdempotent(
        tx,
        {
          key: idempotencyKey,
          scope: "elo.correct",
          userId: actor.id,
          requestHash: hashRequest(payload),
          onReplay: () => {
            if (swept === 0) ctx.dirty = false;
          },
        },
        async () => {
          assertEloVersion(match, input.expectedVersion);
          assertEloAction("correct", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
          if (match.resultVersion !== input.resultVersion) fail("STALE_VERSION");
          const c = input.changes;
          const result = validateEloResult({
            winnerSide: c.winnerSide ?? match.winnerSide!,
            endType: c.endType ?? match.endType!,
            cupsRemainingA: c.cupsRemainingA !== undefined ? c.cupsRemainingA : match.cupsRemainingA,
            cupsRemainingB: c.cupsRemainingB !== undefined ? c.cupsRemainingB : match.cupsRemainingB,
          });
          const rated = c.rated ?? match.rated;
          const before = sidesOf(match);
          const roster = { sideA: c.sideA ?? before.sideA, sideB: c.sideB ?? before.sideB };
          const rosterChanged = !sameSet(roster.sideA, before.sideA) || !sameSet(roster.sideB, before.sideB);
          const resultChanged =
            result.winnerSide !== match.winnerSide ||
            result.endType !== match.endType ||
            result.cupsRemainingA !== match.cupsRemainingA ||
            result.cupsRemainingB !== match.cupsRemainingB;
          const ratedChanged = rated !== match.rated;
          if (!rosterChanged && !resultChanged && !ratedChanged)
            fail("VALIDATION", "Es wurde nichts geändert.");

          if (rosterChanged) {
            assertValidRoster(roster.sideA, roster.sideB, {
              minTeamSize: session.minTeamSize,
              maxTeamSize: session.maxTeamSize,
            });
            await assertKnownPlayers(tx, [...roster.sideA, ...roster.sideB]);
            const ratingAtStart = new Map(match.participants.map((p) => [p.userId, p.ratingAtStart]));
            await tx.eloMatchParticipant.deleteMany({ where: { matchId: match.id } });
            await tx.eloMatchParticipant.createMany({
              data: [
                ...roster.sideA.map((userId, i) => ({ userId, side: "A" as const, position: i + 1 })),
                ...roster.sideB.map((userId, i) => ({ userId, side: "B" as const, position: i + 1 })),
              ].map((p) => ({ ...p, matchId: match.id, ratingAtStart: ratingAtStart.get(p.userId) ?? null })),
            });
          }
          const data: Prisma.EloMatchUncheckedUpdateManyInput = {
            ...result,
            rated,
            resultVersion: { increment: 1 },
          };
          const updated = await writeEloMatch(tx, match, data);
          const snapshotBefore = eloMatchSnapshot(match);
          await writeResultRevision(
            tx,
            updated,
            resultChanged || rosterChanged ? "CORRECTED" : "RATED_CHANGED",
            actor.id,
            {
              reason,
              previous: snapshotBefore as unknown as Prisma.InputJsonValue,
            },
          );
          const runReason: RebuildReason = rosterChanged
            ? "ROSTER_CORRECTION"
            : resultChanged
              ? "CORRECTION"
              : "RATED_CHANGED";
          const rebuilt = await rebuildRatings(tx, ctx, session.id, {
            reason: runReason,
            actorId: actor.id,
            note: reason,
          });
          await writeEloEvent(tx, {
            sessionId: session.id,
            matchId: match.id,
            type: "CORRECTED",
            actorId: actor.id,
            payload: { reason, runRevision: rebuilt.run.revision },
          });
          await writeAudit(tx, {
            tournamentId: ctx.tournament.id,
            actorId: actor.id,
            action: "elo.match.correct",
            entityType: "EloMatch",
            entityId: match.id,
            before: snapshotBefore,
            after: {
              ...eloMatchSnapshot(updated),
              runRevision: rebuilt.run.revision,
              ownMatch: match.participants.some((p) => p.userId === actor.id),
            },
            reason,
          });
          return {
            ...eloMutationResult(updated),
            resultVersion: updated.resultVersion,
            runRevision: rebuilt.run.revision,
          };
        },
      ),
    opts,
  );
}

/** Void a completed match (fraud or mistake): removed from the ratings by a full replay. */
export async function voidCompletedEloMatch(
  actor: Actor,
  input: { matchId: string; expectedVersion: number; reason: string },
  opts?: EloOpts,
): Promise<EloCorrectionResult> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 5);
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("voidCompleted", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const updated = await writeEloMatch(tx, match, { status: "VOIDED", resultVersion: { increment: 1 } });
      await writeResultRevision(tx, updated, "VOIDED", actor.id, { reason });
      const rebuilt = await rebuildRatings(tx, ctx, session.id, {
        reason: "VOID",
        actorId: actor.id,
        note: reason,
      });
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "VOIDED",
        actorId: actor.id,
        payload: { reason, runRevision: rebuilt.run.revision },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "elo.match.void",
        entityType: "EloMatch",
        entityId: match.id,
        before: eloMatchSnapshot(match),
        after: {
          ...eloMatchSnapshot(updated),
          runRevision: rebuilt.run.revision,
          ownMatch: match.participants.some((p) => p.userId === actor.id),
        },
        reason,
      });
      return {
        ...eloMutationResult(updated),
        resultVersion: updated.resultVersion,
        runRevision: rebuilt.run.revision,
      };
    },
    opts,
  );
}
