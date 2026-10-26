// Game mode of the event (Tournament.gameMode): reading it, the guarded switch between the
// competitive tournament and Elo Mode, and two admin helpers that work in any tournament status.
//
// The switch runs in the event transaction, so it serializes with every competitive and Elo write.
// It is refused while the current mode still has open matches; nothing is ever deleted.
import { db, type Db, type Tx } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { assertRole } from "@/server/auth/roles";
import { fail } from "@/server/domain/errors";
import type { GameMode } from "@/generated/prisma/enums";
import { writeAudit } from "./audit";
import { releasePlayers, sweepExpiredDrafts, withEloTx, writeEloEvent, type EloOpts } from "./elo-core";
import { createSessionInTx, eloOpenMatches } from "./elo-session";
import { assertReason } from "./matches";
import { getCurrentTournamentId, withTournamentTx, type TxContext } from "./tx";

export type ModeBlocker =
  | { kind: "COMPETITIVE_MATCH"; matchId: string; code: string; status: string; tableNumber: number | null }
  | { kind: "ELO_MATCH"; matchId: string; status: string; tableNumber: number; draft: boolean };

/** Mode of the current tournament (COMPETITIVE when there is none yet). */
export async function readGameMode(
  client: Db | Tx = db,
): Promise<{ tournamentId: string | null; gameMode: GameMode }> {
  const tournamentId = await getCurrentTournamentId(client);
  if (!tournamentId) return { tournamentId: null, gameMode: "COMPETITIVE" };
  const t = await client.tournament.findUnique({ where: { id: tournamentId }, select: { gameMode: true } });
  return { tournamentId, gameMode: t?.gameMode ?? "COMPETITIVE" };
}

/** Matches of the current mode that must be finished, confirmed or cancelled before switching. */
export async function modeSwitchBlockers(tx: Tx, ctx: TxContext): Promise<ModeBlocker[]> {
  if (ctx.tournament.gameMode === "ELO") {
    return (await eloOpenMatches(tx, ctx.tournament.id)).map((b) => ({ kind: "ELO_MATCH" as const, ...b }));
  }
  const rows = await tx.match.findMany({
    where: {
      tournamentId: ctx.tournament.id,
      status: { in: ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] },
    },
    orderBy: { orderIndex: "asc" },
    select: { id: true, code: true, status: true, table: { select: { number: true } } },
  });
  return rows.map((m) => ({
    kind: "COMPETITIVE_MATCH" as const,
    matchId: m.id,
    code: m.code,
    status: m.status,
    tableNumber: m.table?.number ?? null,
  }));
}

/** Admin read: current mode and what blocks a switch right now. */
export async function getModeStatus(actor: Actor, opts: EloOpts = {}) {
  assertRole(actor, "ADMIN");
  return withEloTx(async ({ tx, ctx, session, swept }) => {
    if (swept === 0) ctx.dirty = false;
    return {
      gameMode: ctx.tournament.gameMode,
      blockers: await modeSwitchBlockers(tx, ctx),
      sessionId: session?.id ?? null,
    };
  }, opts);
}

/**
 * Switch the event's mode. Refused (MODE_SWITCH_BLOCKED, with the list) while the current mode has
 * open matches. The first switch to ELO opens a session; later switches reuse the open session,
 * so the leaderboard comes back. Competitive data is never touched.
 */
export async function setGameMode(
  actor: Actor,
  input: { mode: GameMode },
  opts: EloOpts = {},
): Promise<{ gameMode: GameMode; changed: boolean; sessionId: string | null; openedSession: boolean }> {
  assertRole(actor, "ADMIN");
  if (input.mode !== "COMPETITIVE" && input.mode !== "ELO") fail("VALIDATION", "Unbekannter Spielmodus.");
  return withEloTx(async ({ tx, ctx, session, swept }) => {
    const before = ctx.tournament.gameMode;
    if (before === input.mode) {
      if (swept === 0) ctx.dirty = false;
      return { gameMode: before, changed: false, sessionId: session?.id ?? null, openedSession: false };
    }
    const blockers = await modeSwitchBlockers(tx, ctx);
    if (blockers.length > 0) {
      fail(
        "MODE_SWITCH_BLOCKED",
        `Zuerst ${blockers.length === 1 ? "das offene Match" : `die ${blockers.length} offenen Matches`} abschliessen, bestätigen oder abbrechen.`,
        { blockers },
      );
    }
    let sessionId = session && session.status !== "CLOSED" ? session.id : null;
    let openedSession = false;
    if (input.mode === "ELO" && !session) {
      sessionId = (await createSessionInTx(tx, ctx, actor.id)).id;
      openedSession = true;
    }
    await tx.tournament.update({
      where: { id: ctx.tournament.id },
      data: { gameMode: input.mode, gameModeChangedAt: ctx.now },
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "game.mode",
      entityType: "Tournament",
      entityId: ctx.tournament.id,
      before: { gameMode: before },
      after: { gameMode: input.mode, openedSession, sessionId },
    });
    return {
      gameMode: input.mode,
      changed: true,
      sessionId: sessionId ?? session?.id ?? null,
      openedSession,
    };
  }, opts);
}

/** Explicit admin workflow before a mode switch: cancel every unstarted Elo draft of the event. */
export async function cancelEloDrafts(
  actor: Actor,
  input: { reason: string },
  opts: EloOpts = {},
): Promise<{ cancelled: number }> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 3);
  return withEloTx(async ({ tx, ctx, swept }) => {
    const drafts = await tx.eloMatch.findMany({
      where: { status: "DRAFT", session: { tournamentId: ctx.tournament.id } },
      select: { id: true, sessionId: true },
    });
    for (const d of drafts) {
      await tx.eloMatch.update({
        where: { id: d.id },
        data: {
          status: "CANCELLED",
          cancelledById: actor.id,
          cancelReason: reason,
          version: { increment: 1 },
        },
      });
      await releasePlayers(tx, d.id);
      await writeEloEvent(tx, {
        sessionId: d.sessionId,
        matchId: d.id,
        type: "CANCELLED",
        actorId: actor.id,
        payload: { reason, bulk: true },
      });
    }
    if (drafts.length + swept === 0) ctx.dirty = false;
    if (drafts.length > 0) {
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "elo.drafts.cancel",
        entityType: "Tournament",
        entityId: ctx.tournament.id,
        after: { matchIds: drafts.map((d) => d.id) },
        reason,
      });
    }
    return { cancelled: drafts.length };
  }, opts);
}

/**
 * Public display on/off in any tournament status (updateSettings refuses finished tournaments,
 * but the Elo apéro typically runs after the competitive final).
 */
export async function setPublicDisplay(
  actor: Actor,
  input: { enabled: boolean },
  opts: EloOpts = {},
): Promise<{ publicDisplayEnabled: boolean }> {
  assertRole(actor, "ADMIN");
  const tournamentId = opts.tournamentId ?? (await getCurrentTournamentId(opts.client ?? db));
  if (!tournamentId) fail("NOT_FOUND", "Kein Turnier gefunden.");
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      const swept = await sweepExpiredDrafts(tx, ctx);
      const before = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { publicDisplayEnabled: true },
      });
      if (before.publicDisplayEnabled === input.enabled) {
        if (swept === 0) ctx.dirty = false;
        return { publicDisplayEnabled: input.enabled };
      }
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { publicDisplayEnabled: input.enabled },
      });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.public_display",
        entityType: "Tournament",
        entityId: tournamentId,
        before,
        after: { publicDisplayEnabled: input.enabled },
      });
      return { publicDisplayEnabled: input.enabled };
    },
    opts,
  );
}
