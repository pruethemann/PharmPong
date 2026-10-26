// Elo match lifecycle up to the result: spontaneous drafts on a free table, roster edits, consent
// of both sides, start, stopwatch pause/resume, cancel/leave/abandon. Results: elo-results.ts.
// Who may do what is decided by the pure permission matrix (domain/elo/permissions.ts).
import type { Tx } from "@/server/db";
import { assertRole, isReferee } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { assertEloAction } from "@/server/domain/elo/permissions";
import { assertValidRoster, sideOfUser } from "@/server/domain/elo/roster";
import type { Side } from "@/server/domain/elo/types";
import type { EloSession, Prisma } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import {
  assertEloVersion,
  assertSessionOpen,
  draftExpiry,
  eloFacts,
  eloMatchSnapshot,
  eloMutationResult,
  eloViewer,
  foldEloPause,
  inEloMatchTx,
  lockPlayers,
  releasePlayers,
  rosterHashOf,
  sidesOf,
  withEloTx,
  writeEloEvent,
  writeEloMatch,
  type EloMutationResult,
  type EloOpts,
  type LoadedEloMatch,
} from "./elo-core";
import { activeRun } from "./elo-ratings";
import { assertReason } from "./matches";
import { assertGameMode, type TxContext } from "./tx";

export type RosterInput = { sideA: string[]; sideB: string[]; rated: boolean };

const ACTIVE_COMPETITIVE = ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] as const;

const limitsOf = (s: EloSession) => ({ minTeamSize: s.minTeamSize, maxTeamSize: s.maxTeamSize });

/** Every roster member must be an existing, active account. */
async function assertKnownPlayers(tx: Tx, userIds: readonly string[]): Promise<void> {
  const found = await tx.user.count({ where: { id: { in: [...userIds] }, isActive: true } });
  if (found !== new Set(userIds).size) {
    fail("VALIDATION", "Unbekannte oder deaktivierte Spieler:in in der Aufstellung.", { field: "roster" });
  }
}

/** The table must belong to the event, be enabled and be free of live Elo and competitive matches. */
async function assertFreeTable(tx: Tx, ctx: TxContext, tableId: string, exceptMatchId?: string) {
  const table = await tx.gameTable.findUnique({ where: { id: tableId } });
  if (!table || table.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Tisch nicht gefunden.");
  if (table.isDisabled) fail("TABLE_DISABLED");
  const [elo, competitive] = await Promise.all([
    tx.eloMatch.count({
      where: {
        tableId,
        status: { in: ["DRAFT", "IN_PROGRESS"] },
        ...(exceptMatchId ? { id: { not: exceptMatchId } } : {}),
      },
    }),
    tx.match.count({ where: { tableId, status: { in: [...ACTIVE_COMPETITIVE] } } }),
  ]);
  if (elo + competitive > 0)
    fail("TABLE_BUSY", `An ${table.name} wird gerade gespielt oder er ist reserviert.`);
  return table;
}

function participantRows(matchId: string, sideA: readonly string[], sideB: readonly string[]) {
  return [
    ...sideA.map((userId, i) => ({ matchId, userId, side: "A" as const, position: i + 1 })),
    ...sideB.map((userId, i) => ({ matchId, userId, side: "B" as const, position: i + 1 })),
  ];
}

/** Consent columns: the creator's own side consents automatically; every other consent is cleared. */
function consentColumns(rosterHash: string, creatorSide: Side | null, creatorId: string, now: Date) {
  const cleared = { Hash: null, ById: null, At: null, Method: null };
  const own = { Hash: rosterHash, ById: creatorId, At: now, Method: "CREATOR" as const };
  const a = creatorSide === "A" ? own : cleared;
  const b = creatorSide === "B" ? own : cleared;
  return {
    consentAHash: a.Hash,
    consentAById: a.ById,
    consentAAt: a.At,
    consentAMethod: a.Method,
    consentBHash: b.Hash,
    consentBById: b.ById,
    consentBAt: b.At,
    consentBMethod: b.Method,
  } satisfies Prisma.EloMatchUncheckedUpdateManyInput;
}

/**
 * Create a draft on a free table. The creator plays in it (or is staff); their own side is
 * consented automatically, the other side must confirm on their own phone.
 */
export async function createEloMatch(
  actor: Actor,
  input: RosterInput & { tableId: string },
  opts?: EloOpts,
): Promise<EloMutationResult & { rosterHash: string }> {
  assertRole(actor, "PLAYER");
  return withEloTx(async ({ tx, ctx, session }) => {
    assertGameMode(ctx, "ELO");
    assertSessionOpen(session);
    assertValidRoster(input.sideA, input.sideB, limitsOf(session));
    const creatorSide = sideOfUser(input, actor.id);
    if (!creatorSide && !isReferee(actor)) {
      fail("FORBIDDEN", "Du kannst nur Matches erstellen, in denen du selbst mitspielst.");
    }
    await assertKnownPlayers(tx, [...input.sideA, ...input.sideB]);
    const table = await assertFreeTable(tx, ctx, input.tableId);
    const rosterHash = rosterHashOf(input.sideA, input.sideB, input.rated);
    const match = await tx.eloMatch.create({
      data: {
        sessionId: session.id,
        tableId: table.id,
        createdById: actor.id,
        rated: input.rated,
        resultPolicy: session.resultPolicy,
        rosterHash,
        expiresAt: draftExpiry(ctx.now),
        ...consentColumns(rosterHash, creatorSide, actor.id, ctx.now),
      },
    });
    await tx.eloMatchParticipant.createMany({ data: participantRows(match.id, input.sideA, input.sideB) });
    await lockPlayers(tx, session.id, match.id, [...input.sideA, ...input.sideB]);
    await writeEloEvent(tx, {
      sessionId: session.id,
      matchId: match.id,
      type: "CREATED",
      actorId: actor.id,
      payload: { tableNumber: table.number, rated: input.rated, sideA: input.sideA, sideB: input.sideB },
    });
    return { ...eloMutationResult(match), rosterHash };
  }, opts);
}

/** Replace the roster (and optionally the table or the rated flag) of a draft. */
export async function updateEloRoster(
  actor: Actor,
  input: RosterInput & { matchId: string; expectedVersion: number; tableId?: string },
  opts?: EloOpts,
): Promise<EloMutationResult & { rosterHash: string }> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertGameMode(ctx, "ELO");
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("editRoster", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      assertValidRoster(input.sideA, input.sideB, limitsOf(session));
      await assertKnownPlayers(tx, [...input.sideA, ...input.sideB]);
      const tableId = input.tableId ?? match.tableId;
      if (tableId !== match.tableId) await assertFreeTable(tx, ctx, tableId, match.id);

      const before = sidesOf(match);
      const now = [...input.sideA, ...input.sideB];
      const was = [...before.sideA, ...before.sideB];
      await tx.eloMatchParticipant.deleteMany({ where: { matchId: match.id } });
      await tx.eloMatchParticipant.createMany({ data: participantRows(match.id, input.sideA, input.sideB) });
      await releasePlayers(
        tx,
        match.id,
        was.filter((id) => !now.includes(id)),
      );
      await lockPlayers(
        tx,
        session.id,
        match.id,
        now.filter((id) => !was.includes(id)),
      );

      const rosterHash = rosterHashOf(input.sideA, input.sideB, input.rated);
      // The creator re-confirms their own side by editing; staff edits need both sides again.
      const creatorSide = actor.id === match.createdById ? sideOfUser(input, actor.id) : null;
      const updated = await writeEloMatch(tx, match, {
        tableId,
        rated: input.rated,
        rosterHash,
        expiresAt: draftExpiry(ctx.now),
        ...consentColumns(rosterHash, creatorSide, actor.id, ctx.now),
      });
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "ROSTER_CHANGED",
        actorId: actor.id,
        payload: { sideA: input.sideA, sideB: input.sideB, rated: input.rated, tableId },
      });
      if (actor.id !== match.createdById) {
        await writeAudit(tx, {
          tournamentId: ctx.tournament.id,
          actorId: actor.id,
          action: "elo.match.roster",
          entityType: "EloMatch",
          entityId: match.id,
          before: eloMatchSnapshot(match),
          after: eloMatchSnapshot(updated),
        });
      }
      return { ...eloMutationResult(updated), rosterHash };
    },
    opts,
  );
}

/** A participant confirms the roster for their own side (exactly the roster they saw). */
export async function consentEloRoster(
  actor: Actor,
  input: { matchId: string; rosterHash: string },
  opts?: EloOpts,
): Promise<EloMutationResult & { ready: boolean }> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloAction("consent", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      if (input.rosterHash !== match.rosterHash) fail("ROSTER_CHANGED");
      const side = match.participants.find((p) => p.userId === actor.id)!.side;
      const consent =
        side === "A"
          ? {
              consentAHash: match.rosterHash,
              consentAById: actor.id,
              consentAAt: ctx.now,
              consentAMethod: "PARTICIPANT" as const,
            }
          : {
              consentBHash: match.rosterHash,
              consentBById: actor.id,
              consentBAt: ctx.now,
              consentBMethod: "PARTICIPANT" as const,
            };
      const updated = await writeEloMatch(tx, match, { ...consent, expiresAt: draftExpiry(ctx.now) });
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "CONSENTED",
        actorId: actor.id,
        payload: { side },
      });
      const facts = eloFacts(updated, ctx.now.getTime());
      return { ...eloMutationResult(updated), ready: facts.consentA && facts.consentB };
    },
    opts,
  );
}

/** Non-participating staff record in-person consent for one or both sides (audited). */
export async function staffConsentEloRoster(
  actor: Actor,
  input: { matchId: string; rosterHash: string; sides: Side[]; note?: string },
  opts?: EloOpts,
): Promise<EloMutationResult & { ready: boolean }> {
  assertRole(actor, "REFEREE");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloAction("staffConsent", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      if (input.rosterHash !== match.rosterHash) fail("ROSTER_CHANGED");
      const facts = eloFacts(match, ctx.now.getTime());
      const sides = [...new Set(input.sides)].filter((s) => (s === "A" ? !facts.consentA : !facts.consentB));
      if (sides.length === 0)
        fail("VALIDATION", "Bitte ein Team wählen, das noch nicht bestätigt hat.", { field: "sides" });
      const data: Prisma.EloMatchUncheckedUpdateManyInput = { expiresAt: draftExpiry(ctx.now) };
      for (const s of sides) {
        Object.assign(
          data,
          s === "A"
            ? {
                consentAHash: match.rosterHash,
                consentAById: actor.id,
                consentAAt: ctx.now,
                consentAMethod: "STAFF",
              }
            : {
                consentBHash: match.rosterHash,
                consentBById: actor.id,
                consentBAt: ctx.now,
                consentBMethod: "STAFF",
              },
        );
      }
      const updated = await writeEloMatch(tx, match, data);
      const note = input.note?.trim().slice(0, 300) || null;
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "CONSENTED_BY_STAFF",
        actorId: actor.id,
        payload: { sides, note },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "elo.match.staff_consent",
        entityType: "EloMatch",
        entityId: match.id,
        before: eloMatchSnapshot(match),
        after: { ...eloMatchSnapshot(updated), sides },
        reason: note,
      });
      const after = eloFacts(updated, ctx.now.getTime());
      return { ...eloMutationResult(updated), ready: after.consentA && after.consentB };
    },
    opts,
  );
}

/** A participant leaves a draft; an emptied side cancels it. Consent must be given again. */
export async function leaveEloMatch(
  actor: Actor,
  input: { matchId: string },
  opts?: EloOpts,
): Promise<EloMutationResult & { rosterHash: string }> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloAction("leave", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const { sideA, sideB } = sidesOf(match);
      const rest = {
        sideA: sideA.filter((id) => id !== actor.id),
        sideB: sideB.filter((id) => id !== actor.id),
      };
      await tx.eloMatchParticipant.deleteMany({ where: { matchId: match.id, userId: actor.id } });
      await releasePlayers(tx, match.id, [actor.id]);
      await writeEloEvent(tx, { sessionId: session.id, matchId: match.id, type: "LEFT", actorId: actor.id });
      if (rest.sideA.length === 0 || rest.sideB.length === 0) {
        const cancelled = await writeEloMatch(tx, match, {
          status: "CANCELLED",
          cancelledById: actor.id,
          cancelReason: "LEFT",
        });
        await releasePlayers(tx, match.id);
        await writeEloEvent(tx, {
          sessionId: session.id,
          matchId: match.id,
          type: "CANCELLED",
          actorId: actor.id,
          payload: { reason: "LEFT" },
        });
        return { ...eloMutationResult(cancelled), rosterHash: match.rosterHash };
      }
      const rosterHash = rosterHashOf(rest.sideA, rest.sideB, match.rated);
      const creatorSide = sideOfUser(rest, match.createdById);
      const updated = await writeEloMatch(tx, match, {
        rosterHash,
        expiresAt: draftExpiry(ctx.now),
        ...consentColumns(rosterHash, creatorSide, match.createdById, ctx.now),
      });
      return { ...eloMutationResult(updated), rosterHash };
    },
    opts,
  );
}

/** The creator or non-participating staff cancel an unstarted draft. No rating effect. */
export async function cancelEloMatch(
  actor: Actor,
  input: { matchId: string; expectedVersion?: number; reason?: string },
  opts?: EloOpts,
): Promise<EloMutationResult> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("cancel", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const byCreator = actor.id === match.createdById;
      const reason = input.reason?.trim().slice(0, 500) || (byCreator ? "CREATOR" : "STAFF");
      const updated = await writeEloMatch(tx, match, {
        status: "CANCELLED",
        cancelledById: actor.id,
        cancelReason: reason,
      });
      await releasePlayers(tx, match.id);
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "CANCELLED",
        actorId: actor.id,
        payload: { reason },
      });
      if (!byCreator) {
        await writeAudit(tx, {
          tournamentId: ctx.tournament.id,
          actorId: actor.id,
          action: "elo.match.cancel",
          entityType: "EloMatch",
          entityId: match.id,
          before: eloMatchSnapshot(match),
          after: eloMatchSnapshot(updated),
          reason,
        });
      }
      return eloMutationResult(updated);
    },
    opts,
  );
}

/** DRAFT → IN_PROGRESS once both sides consented; the stopwatch starts at the DB clock. */
export async function startEloMatch(
  actor: Actor,
  input: { matchId: string; expectedVersion: number },
  opts?: EloOpts,
): Promise<EloMutationResult & { startedAt: string }> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertGameMode(ctx, "ELO");
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("start", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      assertSessionOpen(session);
      const table = await tx.gameTable.findUniqueOrThrow({ where: { id: match.tableId } });
      if (table.isDisabled) fail("TABLE_DISABLED");
      // Informational snapshot of the ratings at the start (never an input of the calculation).
      const run = await activeRun(tx, session.id);
      const ratings = await tx.eloPlayerRating.findMany({
        where: { sessionId: session.id, userId: { in: match.participants.map((p) => p.userId) } },
        select: { userId: true, rating: true },
      });
      const byUser = new Map(ratings.map((r) => [r.userId, r.rating]));
      for (const p of match.participants) {
        await tx.eloMatchParticipant.update({
          where: { id: p.id },
          data: { ratingAtStart: byUser.get(p.userId) ?? run.initialRating },
        });
      }
      const updated = await writeEloMatch(tx, match, {
        status: "IN_PROGRESS",
        startedAt: ctx.now,
        pausedAt: null,
        pausedDurationMs: 0,
        endedAt: null,
        expiresAt: null,
      });
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "STARTED",
        actorId: actor.id,
        payload: { tableNumber: table.number },
      });
      return { ...eloMutationResult(updated), startedAt: ctx.now.toISOString() };
    },
    opts,
  );
}

async function clock(
  actor: Actor,
  input: { matchId: string; expectedVersion: number },
  action: "pause" | "resume",
  opts?: EloOpts,
): Promise<EloMutationResult> {
  assertRole(actor, "PLAYER");
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloVersion(match, input.expectedVersion);
      assertEloAction(action, eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const updated = await writeEloMatch(
        tx,
        match,
        action === "pause" ? { pausedAt: ctx.now } : foldEloPause(match, ctx.now),
      );
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: action === "pause" ? "PAUSED" : "RESUMED",
        actorId: actor.id,
        payload:
          action === "resume" ? { pausedMs: updated.pausedDurationMs - match.pausedDurationMs } : undefined,
      });
      return eloMutationResult(updated);
    },
    opts,
  );
}

export const pauseEloMatch = (
  actor: Actor,
  input: { matchId: string; expectedVersion: number },
  opts?: EloOpts,
) => clock(actor, input, "pause", opts);
export const resumeEloMatch = (
  actor: Actor,
  input: { matchId: string; expectedVersion: number },
  opts?: EloOpts,
) => clock(actor, input, "resume", opts);

/** Staff free a table whose match cannot be finished: CANCELLED without any rating effect. */
export async function abandonEloMatch(
  actor: Actor,
  input: { matchId: string; expectedVersion: number; reason: string },
  opts?: EloOpts,
): Promise<EloMutationResult> {
  assertRole(actor, "REFEREE");
  const reason = assertReason(input.reason, 3);
  return inEloMatchTx(
    input.matchId,
    async ({ tx, ctx, match, session }) => {
      assertEloVersion(match, input.expectedVersion);
      assertEloAction("abandon", eloFacts(match, ctx.now.getTime()), eloViewer(actor));
      const updated = await writeEloMatch(tx, match, {
        status: "CANCELLED",
        ...foldEloPause(match, ctx.now),
        endedAt: ctx.now,
        cancelledById: actor.id,
        cancelReason: reason,
      });
      await releasePlayers(tx, match.id);
      await writeEloEvent(tx, {
        sessionId: session.id,
        matchId: match.id,
        type: "ABANDONED",
        actorId: actor.id,
        payload: { reason },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "elo.match.abandon",
        entityType: "EloMatch",
        entityId: match.id,
        before: eloMatchSnapshot(match),
        after: eloMatchSnapshot(updated),
        reason,
      });
      return eloMutationResult(updated);
    },
    opts,
  );
}

/** Exported for tests: the creator's consent columns. */
export const __test = { consentColumns };
export type { LoadedEloMatch };
