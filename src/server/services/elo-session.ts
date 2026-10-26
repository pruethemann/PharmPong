// Elo sessions (one evening's ranking within an event): open, pause new matches, close with the
// champion(s), audited reopen, settings, and the recalculation procedure for rating parameters.
// All ADMIN; everything runs in the event transaction.
import type { Actor } from "@/server/auth/sessions";
import { assertRole } from "@/server/auth/roles";
import { fail } from "@/server/domain/errors";
import {
  DEFAULT_ELO_PARAMS,
  ELO_ALGORITHM_VERSION,
  ELO_CLOSE_CONFIRM_TEXT,
  ELO_RECALC_CONFIRM_TEXT,
  paramsDiffer,
  validateEloParams,
  validateSessionSettings,
  type EloSessionSettings,
} from "@/server/domain/elo/config";
import { championsOf, rankPlayers } from "@/server/domain/elo/ranking";
import type { EloParams } from "@/server/domain/elo/types";
import type { Tx } from "@/server/db";
import type { EloSession } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import { withEloTx, type EloOpts } from "./elo-core";
import { activeRun, paramsOfRun, rebuildRatings, type RebuildResult } from "./elo-ratings";
import { assertReason } from "./matches";
import type { TxContext } from "./tx";

export const CLOSE_CONFIRM_TEXT = ELO_CLOSE_CONFIRM_TEXT;
export const RECALC_CONFIRM_TEXT = ELO_RECALC_CONFIRM_TEXT;
export const DEFAULT_SESSION_NAME = "Social Elo";

export type EloBlocker = { matchId: string; status: string; tableNumber: number; draft: boolean };

/** Elo matches that still need a decision (block a mode switch and closing the session). */
export async function eloOpenMatches(tx: Tx, tournamentId: string): Promise<EloBlocker[]> {
  const rows = await tx.eloMatch.findMany({
    where: {
      session: { tournamentId },
      status: { in: ["DRAFT", "IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, table: { select: { number: true } } },
  });
  return rows.map((m) => ({
    matchId: m.id,
    status: m.status,
    tableNumber: m.table.number,
    draft: m.status === "DRAFT",
  }));
}

const sessionSnapshot = (s: EloSession) => ({
  name: s.name,
  status: s.status,
  minTeamSize: s.minTeamSize,
  maxTeamSize: s.maxTeamSize,
  minGamesForChampion: s.minGamesForChampion,
  softReminderMinutes: s.softReminderMinutes,
  resultPolicy: s.resultPolicy,
  championUserIds: s.championUserIds,
  closedAt: s.closedAt?.toISOString() ?? null,
  configVersion: s.configVersion,
});

/** A new OPEN session with run #1 (spec default parameters). Caller holds the event lock. */
export async function createSessionInTx(
  tx: Tx,
  ctx: TxContext,
  actorId: string,
  name = DEFAULT_SESSION_NAME,
): Promise<EloSession> {
  const session = await tx.eloSession.create({
    data: { tournamentId: ctx.tournament.id, name, createdById: actorId },
  });
  await tx.eloRatingRun.create({
    data: {
      sessionId: session.id,
      revision: 1,
      reason: "INITIAL",
      triggeredById: actorId,
      algorithmVersion: ELO_ALGORITHM_VERSION,
      initialRating: DEFAULT_ELO_PARAMS.initialRating,
      kFactor: DEFAULT_ELO_PARAMS.kFactor,
      ratingScale: DEFAULT_ELO_PARAMS.ratingScale,
      repeatMultipliers: [...DEFAULT_ELO_PARAMS.repeatMultipliers],
      runtime: process.version,
    },
  });
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId,
    action: "elo.session.open",
    entityType: "EloSession",
    entityId: session.id,
    after: sessionSnapshot(session),
  });
  return session;
}

function cleanName(raw: string | undefined): string {
  const name = (raw ?? DEFAULT_SESSION_NAME).trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60)
    fail("VALIDATION", "Der Name braucht 2 bis 60 Zeichen.", { field: "name" });
  return name;
}

/** Open a new session (only when no other session of the event is open or paused). */
export async function openEloSession(actor: Actor, input: { name?: string } = {}, opts?: EloOpts) {
  assertRole(actor, "ADMIN");
  const name = cleanName(input.name);
  return withEloTx(async ({ tx, ctx, session }) => {
    if (session && session.status !== "CLOSED") {
      fail("INVALID_STATE", "Es läuft bereits eine Elo-Runde. Schliesse sie zuerst ab.");
    }
    const created = await createSessionInTx(tx, ctx, actor.id, name);
    return { sessionId: created.id, configVersion: created.configVersion };
  }, opts);
}

type SessionInput = { sessionId: string; expectedConfigVersion: number };

async function lockedSession(tx: Tx, ctx: TxContext, input: SessionInput): Promise<EloSession> {
  const s = await tx.eloSession.findUnique({ where: { id: input.sessionId } });
  if (!s || s.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Elo-Runde nicht gefunden.");
  if (s.configVersion !== input.expectedConfigVersion) {
    fail("STALE_VERSION", undefined, { expected: input.expectedConfigVersion, actual: s.configVersion });
  }
  return s;
}

/** OPEN ⇄ PAUSED (paused: no new matches start; running ones can finish). */
export async function setEloSessionStatus(
  actor: Actor,
  input: SessionInput & { status: "OPEN" | "PAUSED" },
  opts?: EloOpts,
) {
  assertRole(actor, "ADMIN");
  return withEloTx(async ({ tx, ctx }) => {
    const s = await lockedSession(tx, ctx, input);
    if (s.status === "CLOSED") fail("INVALID_STATE", "Die Elo-Runde ist beendet. Öffne sie zuerst wieder.");
    if (s.status === input.status) {
      ctx.dirty = false;
      return { sessionId: s.id, status: s.status, configVersion: s.configVersion };
    }
    const updated = await tx.eloSession.update({
      where: { id: s.id },
      data: { status: input.status, configVersion: { increment: 1 } },
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: input.status === "PAUSED" ? "elo.session.pause" : "elo.session.resume",
      entityType: "EloSession",
      entityId: s.id,
      before: sessionSnapshot(s),
      after: sessionSnapshot(updated),
    });
    return { sessionId: s.id, status: updated.status, configVersion: updated.configVersion };
  }, opts);
}

/** Close the session and fix the champion(s): eligible players with the top full-precision rating. */
export async function closeEloSession(
  actor: Actor,
  input: SessionInput & { confirmText: string },
  opts?: EloOpts,
) {
  assertRole(actor, "ADMIN");
  if (input.confirmText.trim() !== CLOSE_CONFIRM_TEXT) fail("CONFIRMATION_REQUIRED");
  return withEloTx(async ({ tx, ctx }) => {
    const s = await lockedSession(tx, ctx, input);
    if (s.status === "CLOSED") fail("INVALID_STATE", "Die Elo-Runde ist bereits beendet.");
    const open = await eloOpenMatches(tx, ctx.tournament.id);
    if (open.length > 0) {
      fail("INVALID_STATE", "Zuerst alle offenen Matches abschliessen, bestätigen oder abbrechen.", {
        blockers: open,
      });
    }
    const run = await activeRun(tx, s.id);
    const players = await tx.eloPlayerRating.findMany({ where: { sessionId: s.id } });
    const ranked = rankPlayers(players, {
      minGamesForChampion: s.minGamesForChampion,
      initialRating: run.initialRating,
    });
    const champions = championsOf(ranked).map((p) => p.userId);
    const updated = await tx.eloSession.update({
      where: { id: s.id },
      data: {
        status: "CLOSED",
        closedAt: ctx.now,
        championUserIds: champions,
        configVersion: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "elo.session.close",
      entityType: "EloSession",
      entityId: s.id,
      before: sessionSnapshot(s),
      after: { ...sessionSnapshot(updated), eligiblePlayers: ranked.filter((p) => p.eligible).length },
    });
    return {
      sessionId: s.id,
      championUserIds: champions,
      eligiblePlayers: ranked.filter((p) => p.eligible).length,
    };
  }, opts);
}

/** CLOSED → OPEN (audited); the champion title is withdrawn until the next close. */
export async function reopenEloSession(
  actor: Actor,
  input: SessionInput & { reason: string },
  opts?: EloOpts,
) {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 5);
  return withEloTx(async ({ tx, ctx }) => {
    const s = await lockedSession(tx, ctx, input);
    if (s.status !== "CLOSED")
      fail("INVALID_STATE", "Nur eine beendete Elo-Runde kann wieder geöffnet werden.");
    const other = await tx.eloSession.count({
      where: { tournamentId: ctx.tournament.id, status: { not: "CLOSED" } },
    });
    if (other > 0) fail("INVALID_STATE", "Es läuft bereits eine andere Elo-Runde.");
    const updated = await tx.eloSession.update({
      where: { id: s.id },
      data: { status: "OPEN", closedAt: null, championUserIds: [], configVersion: { increment: 1 } },
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "elo.session.reopen",
      entityType: "EloSession",
      entityId: s.id,
      before: sessionSnapshot(s),
      after: sessionSnapshot(updated),
      reason,
    });
    return { sessionId: s.id, configVersion: updated.configVersion };
  }, opts);
}

/** Settings that never change existing ratings (team sizes, champion minimum, reminder, policy). */
export async function updateEloSettings(
  actor: Actor,
  input: SessionInput & { settings: EloSessionSettings },
  opts?: EloOpts,
) {
  assertRole(actor, "ADMIN");
  const settings = validateSessionSettings(input.settings);
  return withEloTx(async ({ tx, ctx }) => {
    const s = await lockedSession(tx, ctx, input);
    if (s.status === "CLOSED") fail("INVALID_STATE", "Die Elo-Runde ist beendet.");
    const updated = await tx.eloSession.update({
      where: { id: s.id },
      data: { ...settings, configVersion: { increment: 1 } },
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "elo.session.settings",
      entityType: "EloSession",
      entityId: s.id,
      before: sessionSnapshot(s),
      after: sessionSnapshot(updated),
    });
    return { sessionId: s.id, configVersion: updated.configVersion };
  }, opts);
}

function confirmed(input: { confirmText?: string }): boolean {
  return input.confirmText?.trim() === RECALC_CONFIRM_TEXT;
}

/**
 * Change the rating parameters. They never change silently: the session is replayed into a new
 * calculation run. Once rated matches exist this needs the typed confirmation and a reason.
 */
export async function updateEloParams(
  actor: Actor,
  input: SessionInput & { params: EloParams; reason?: string; confirmText?: string },
  opts?: EloOpts,
): Promise<{ sessionId: string; changed: boolean; runRevision: number }> {
  assertRole(actor, "ADMIN");
  const params = validateEloParams(input.params);
  return withEloTx(async ({ tx, ctx }) => {
    const s = await lockedSession(tx, ctx, input);
    if (s.status === "CLOSED") fail("INVALID_STATE", "Die Elo-Runde ist beendet.");
    const run = await activeRun(tx, s.id);
    if (!paramsDiffer(paramsOfRun(run), params)) {
      ctx.dirty = false;
      return { sessionId: s.id, changed: false, runRevision: run.revision };
    }
    const rated = await tx.eloMatch.count({ where: { sessionId: s.id, status: "COMPLETED", rated: true } });
    let reason: string | null = null;
    if (rated > 0) {
      if (!confirmed(input)) fail("CONFIRMATION_REQUIRED");
      reason = assertReason(input.reason, 5);
    }
    const result = await rebuildRatings(tx, ctx, s.id, {
      reason: "CONFIG_CHANGE",
      actorId: actor.id,
      note: reason,
      params,
    });
    await tx.eloSession.update({ where: { id: s.id }, data: { configVersion: { increment: 1 } } });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "elo.params",
      entityType: "EloSession",
      entityId: s.id,
      before: { ...paramsOfRun(run), runRevision: run.revision },
      after: { ...params, runRevision: result.run.revision, digest: result.digest },
      reason,
    });
    return { sessionId: s.id, changed: true, runRevision: result.run.revision };
  }, opts);
}

/** Manual "Neu berechnen": full replay into a new run with the same parameters (audited). */
export async function recalculateElo(
  actor: Actor,
  input: { sessionId: string; reason: string; confirmText: string },
  opts?: EloOpts,
): Promise<{ sessionId: string; runRevision: number; digest: string; unchanged: boolean }> {
  assertRole(actor, "ADMIN");
  if (!confirmed(input)) fail("CONFIRMATION_REQUIRED");
  const reason = assertReason(input.reason, 5);
  return withEloTx(async ({ tx, ctx }) => {
    const s = await tx.eloSession.findUnique({ where: { id: input.sessionId } });
    if (!s || s.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Elo-Runde nicht gefunden.");
    const result: RebuildResult = await rebuildRatings(tx, ctx, s.id, {
      reason: "MANUAL",
      actorId: actor.id,
      note: reason,
    });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "elo.recalculate",
      entityType: "EloSession",
      entityId: s.id,
      before: { digest: result.previousDigest },
      after: { runRevision: result.run.revision, digest: result.digest, players: result.players },
      reason,
    });
    return {
      sessionId: s.id,
      runRevision: result.run.revision,
      digest: result.digest,
      unchanged: result.previousDigest === result.digest,
    };
  }, opts);
}
