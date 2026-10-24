// Audited result corrections and the recovery wizard.
//
// correctResult: changes a confirmed result and re-seeds every knockout slot that
// depends on it, as long as no affected downstream match has started. Otherwise
// it throws DOWNSTREAM_STARTED and the whole transaction rolls back.
//
// executeRecovery: voids the affected downstream matches (history stays in the
// audit log / match events), reopens the tournament phase if needed, applies the
// corrected result and re-seeds the bracket, all in one transaction.
import { db, type Db, type Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import {
  diffKnockoutSlots,
  downstreamCodes,
  expectedKnockoutSlots,
  KNOCKOUT_CODES,
  type SlotPair,
} from "@/server/domain/bracket";
import { fail } from "@/server/domain/errors";
import { assertMatchTransition, isDecidedStatus } from "@/server/domain/match-state";
import { validateResult } from "@/server/domain/result-rules";
import { computeGroupStandings, computeQualifiers } from "@/server/domain/standings";
import { assertTransition } from "@/server/domain/tournament-state";
import type { GroupName } from "@/server/domain/types";
import type { Match, MatchStatus } from "@/generated/prisma/client";
import { writeAudit, writeMatchEvent } from "./audit";
import {
  assertReason,
  assertVersion,
  CLEARED_RESULT_FIELDS,
  CLEARED_RUN_FIELDS,
  getLockedMatch,
  inMatchTx,
  matchSnapshot,
  matchTournamentId,
  releaseTeamLocks,
  writeMatch,
} from "./matches";
import { crownChampion, type ResultFields } from "./results";
import { loadTournamentState, lockMatches } from "./state";
import type { TxContext, TxOptions } from "./tx";

const MUTABLE_SLOT_STATUSES: readonly MatchStatus[] = ["PENDING", "READY", "ASSIGNED"];

export type CorrectionInput = ResultFields & {
  matchId: string;
  expectedVersion: number;
  reason: string;
};

export type CorrectionOutcome = {
  matchId: string;
  version: number;
  resultRevision: number;
  /** Knockout matches whose slots were re-seeded. */
  reseeded: string[];
  championTeamId: string | null;
};

const resultOf = (m: Match) => ({
  winnerTeamId: m.winnerTeamId,
  homeCupsRemaining: m.homeCupsRemaining,
  awayCupsRemaining: m.awayCupsRemaining,
  endType: m.endType,
});

/** Validate and write the corrected result on a decided match. */
async function applyCorrection(
  tx: Tx,
  ctx: TxContext,
  actor: Actor,
  match: Match,
  input: ResultFields,
  reason: string,
  recovery: boolean,
): Promise<Match> {
  if (!isDecidedStatus(match.status)) {
    fail("INVALID_STATE", "Nur bestätigte Resultate können korrigiert werden.");
  }
  const result = validateResult(
    {
      homeTeamId: match.homeTeamId!,
      awayTeamId: match.awayTeamId!,
      winnerTeamId: input.winnerTeamId,
      homeCupsRemaining: input.homeCupsRemaining,
      awayCupsRemaining: input.awayCupsRemaining,
      endType: input.endType,
    },
    { allowForfeit: true },
  );
  // The status follows the corrected end type (both are decided statuses).
  const status: MatchStatus = result.endType === "FORFEIT" ? "FORFEITED" : "COMPLETED";
  if (status !== match.status) assertMatchTransition(match.status, status, { recovery: true });
  const updated = await writeMatch(tx, match, { ...result, status, resultRevision: { increment: 1 } });
  const before = resultOf(match);
  const after = resultOf(updated);
  await writeMatchEvent(tx, {
    tournamentId: ctx.tournament.id,
    matchId: match.id,
    type: "CORRECTED",
    actorId: actor.id,
    payload: { before, after, reason },
  });
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId: actor.id,
    action: "match.correct",
    entityType: "Match",
    entityId: match.id,
    before: matchSnapshot(match),
    after: { ...matchSnapshot(updated), recovery },
    reason,
  });
  return updated;
}

/**
 * Void tiebreak decisions of a group whose tie basis no longer exists
 * (the stats of the tied teams changed). The domain already ignores them.
 */
async function voidStaleTiebreaks(tx: Tx, ctx: TxContext, actor: Actor, groupId: string): Promise<void> {
  const active = await tx.groupTiebreak.findMany({ where: { groupId, voidedAt: null } });
  if (active.length === 0) return;
  const group = await tx.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { assignments: { orderBy: { position: "asc" } } },
  });
  const state = await loadTournamentState(tx, ctx.tournament.id);
  const name = group.name as GroupName;
  const raw = computeGroupStandings(
    name,
    group.assignments.map((a) => a.teamId),
    state.matches.filter((m) => m.stage === "GROUP" && m.group === name),
    [],
  );
  const live = new Set(raw.unresolved.map((u) => u.basisHash));
  for (const t of active) {
    if (live.has(t.basisHash)) continue;
    await tx.groupTiebreak.update({ where: { id: t.id }, data: { voidedAt: ctx.now } });
    await writeAudit(tx, {
      tournamentId: ctx.tournament.id,
      actorId: actor.id,
      action: "tiebreak.void",
      entityType: "GroupTiebreak",
      entityId: t.id,
      before: { teamIds: t.teamIds, orderedTeamIds: t.orderedTeamIds, basisHash: t.basisHash },
      reason: "Korrektur hat den Gleichstand verändert.",
    });
  }
}

/**
 * Re-seed knockout slots after a result change. Throws DOWNSTREAM_STARTED when a
 * slot of a started/decided match would change, UNRESOLVED_TIE when a group
 * correction in the knockout phase leaves a tie without shootout decision.
 */
async function propagate(
  tx: Tx,
  ctx: TxContext,
  actor: Actor,
  corrected: Match,
  reason: string,
): Promise<{ reseeded: string[]; championTeamId: string | null }> {
  if (corrected.stage === "GROUP" && corrected.groupId) {
    await voidStaleTiebreaks(tx, ctx, actor, corrected.groupId);
  }
  const status = ctx.tournament.status;
  const knockoutPhase = status === "KNOCKOUT_STAGE" || status === "COMPLETED";
  const state = await loadTournamentState(tx, ctx.tournament.id);
  if (corrected.stage === "GROUP" && knockoutPhase && !state.qualifiers) {
    fail(
      "UNRESOLVED_TIE",
      "Nach dieser Korrektur ist ein Gruppenplatz unentschieden. Bitte den Wiederherstellungs-Assistenten verwenden.",
      { group: state.matches.find((m) => m.id === corrected.id)?.group ?? null },
    );
  }
  const expected = expectedKnockoutSlots(state.matches, knockoutPhase ? state.qualifiers : null);
  const diffs = diffKnockoutSlots(state.matches, expected);
  const blocked = [
    ...new Set(diffs.filter((d) => !MUTABLE_SLOT_STATUSES.includes(d.status)).map((d) => d.code)),
  ];
  if (blocked.length > 0) {
    fail("DOWNSTREAM_STARTED", undefined, { affected: blocked });
  }

  const codes = [...new Set(diffs.map((d) => d.code))];
  const rows = state.matches.filter((m) => codes.includes(m.code)).map((m) => m.row);
  await lockMatches(
    tx,
    rows.map((r) => r.id),
  );
  for (const code of codes) {
    const fresh = await tx.match.findUniqueOrThrow({
      where: { tournamentId_code: { tournamentId: ctx.tournament.id, code } },
    });
    const pair = (expected as Record<string, SlotPair>)[code];
    await reseedMatch(tx, ctx, actor, fresh, pair, reason);
  }

  let championTeamId: string | null = null;
  if (corrected.code === "F" && isDecidedStatus(corrected.status)) {
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: ctx.tournament.id },
      select: { status: true, championTeamId: true },
    });
    // Same winner (e.g. only the cups were corrected): no new champion announcement.
    championTeamId =
      t.status === "COMPLETED" && t.championTeamId === corrected.winnerTeamId
        ? t.championTeamId
        : await crownChampion(tx, ctx, actor, corrected);
  }
  return { reseeded: codes, championTeamId };
}

/** Put the expected teams into a not-yet-started knockout match. */
async function reseedMatch(
  tx: Tx,
  ctx: TxContext,
  actor: Actor,
  m: Match,
  pair: SlotPair,
  reason: string,
): Promise<Match> {
  const wasAssigned = m.status === "ASSIGNED";
  if (wasAssigned) {
    await releaseTeamLocks(tx, m.id);
  }
  const both = pair.home !== null && pair.away !== null;
  const target: MatchStatus = both && ctx.tournament.status === "KNOCKOUT_STAGE" ? "READY" : "PENDING";
  if (target !== m.status) assertMatchTransition(m.status, target, { recovery: true });
  const updated = await writeMatch(tx, m, {
    homeTeamId: pair.home,
    awayTeamId: pair.away,
    status: target,
    ...(wasAssigned ? { tableId: null, assignedAt: null } : {}),
  });
  if (wasAssigned) {
    await writeMatchEvent(tx, {
      tournamentId: ctx.tournament.id,
      matchId: m.id,
      type: "UNASSIGNED",
      actorId: actor.id,
      payload: { tableId: m.tableId, reason: "correction" },
    });
  }
  for (const [slot, before, after] of [
    ["HOME", m.homeTeamId, pair.home],
    ["AWAY", m.awayTeamId, pair.away],
  ] as const) {
    if (before !== after && after !== null) {
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: m.id,
        type: "ADVANCED",
        actorId: actor.id,
        payload: { teamId: after, toCode: m.code, slot },
      });
    }
  }
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId: actor.id,
    action: "match.reseed",
    entityType: "Match",
    entityId: m.id,
    before: matchSnapshot(m),
    after: matchSnapshot(updated),
    reason,
  });
  return updated;
}

// ─── correctResult ─────────────────────────────────────────────────────────

/** Admin: correct a confirmed result. Allowed only while no affected downstream match has started. */
export async function correctResult(
  actor: Actor,
  input: CorrectionInput,
  opts?: TxOptions,
): Promise<CorrectionOutcome> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 5);
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      const updated = await applyCorrection(tx, ctx, actor, match, input, reason, false);
      const { reseeded, championTeamId } = await propagate(tx, ctx, actor, updated, reason);
      return {
        matchId: updated.id,
        version: updated.version,
        resultRevision: updated.resultRevision,
        reseeded,
        championTeamId,
      };
    },
    opts,
  );
}

// ─── Recovery ──────────────────────────────────────────────────────────────

export type RecoveryTeam = { id: string; name: string } | null;
export type RecoveryPlan = {
  matchId: string;
  code: string;
  confirmText: string;
  /**
   * True when a group correction leaves an unresolved tie, so the whole knockout
   * stage is voided and the tournament returns to GROUP_STAGE. Only known when
   * the plan is requested with the new result.
   */
  resetsKnockout: boolean;
  affected: {
    code: string;
    status: MatchStatus;
    homeTeam: RecoveryTeam;
    awayTeam: RecoveryTeam;
    hasResult: boolean;
  }[];
};

export const recoveryConfirmText = (code: string) => `${code} ZURÜCKSETZEN`;

/**
 * Matches a recovery voids: the knockout matches downstream of `match`. A group
 * correction during the knockout phase resets the whole knockout stage (back to
 * GROUP_STAGE) only when the corrected group ends up with an unresolved tie,
 * because ranking shootouts can only be recorded in the group stage. Without
 * `newResult` (plan preview) that case cannot be known and the narrow scope is
 * returned.
 */
async function recoveryScope(
  client: Db | Tx,
  match: Match,
  tournamentStatus: string,
  newResult?: ResultFields,
): Promise<{ codes: string[]; resetsKnockout: boolean }> {
  const narrow = { codes: downstreamCodes(match.code), resetsKnockout: false };
  const knockoutPhase = tournamentStatus === "KNOCKOUT_STAGE" || tournamentStatus === "COMPLETED";
  if (match.stage !== "GROUP" || !knockoutPhase || !newResult) return narrow;
  const result = validateResult(
    {
      homeTeamId: match.homeTeamId!,
      awayTeamId: match.awayTeamId!,
      winnerTeamId: newResult.winnerTeamId,
      homeCupsRemaining: newResult.homeCupsRemaining,
      awayCupsRemaining: newResult.awayCupsRemaining,
      endType: newResult.endType,
    },
    { allowForfeit: true },
  );
  const state = await loadTournamentState(client, match.tournamentId);
  const group = state.groups.find((g) => g.id === match.groupId);
  if (!group) return narrow;
  const views = state.matches
    .filter((m) => m.stage === "GROUP" && m.group === group.name)
    .map((m) => (m.id === match.id ? { ...m, result } : m));
  const standings = state.standings.map((s) =>
    s.group === group.name
      ? computeGroupStandings(group.name, group.teamIds, views, state.tiebreaks.get(group.name) ?? [])
      : s,
  );
  return computeQualifiers(standings) ? narrow : { codes: [...KNOCKOUT_CODES], resetsKnockout: true };
}

/** Admin, read-only: which downstream matches a recovery for this match would void. */
export async function planRecovery(
  actor: Actor,
  input: { matchId: string; newResult?: ResultFields },
): Promise<RecoveryPlan> {
  assertRole(actor, "ADMIN");
  const tournamentId = await matchTournamentId(input.matchId);
  const [match, tournament] = await Promise.all([
    db.match.findUniqueOrThrow({ where: { id: input.matchId } }),
    db.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { status: true } }),
  ]);
  const { codes, resetsKnockout } = await recoveryScope(db, match, tournament.status, input.newResult);
  const rows = await db.match.findMany({
    where: { tournamentId, code: { in: codes } },
    orderBy: { orderIndex: "asc" },
    include: {
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
    },
  });
  return {
    matchId: match.id,
    code: match.code,
    confirmText: recoveryConfirmText(match.code),
    resetsKnockout,
    affected: rows.map((r) => ({
      code: r.code,
      status: r.status,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      hasResult: r.winnerTeamId !== null,
    })),
  };
}

export type RecoveryInput = {
  matchId: string;
  expectedVersion: number;
  reason: string;
  confirmText: string;
  newResult: ResultFields;
};

export type RecoveryOutcome = CorrectionOutcome & {
  voided: string[];
  tournamentStatus: string;
};

/** Void one downstream match: result, proposal, clock and table cleared; slots emptied (re-seeded later). */
async function voidMatch(tx: Tx, ctx: TxContext, actor: Actor, m: Match, reason: string): Promise<Match> {
  await releaseTeamLocks(tx, m.id);
  if (m.status !== "PENDING") assertMatchTransition(m.status, "PENDING", { recovery: true });
  const hadResult = m.winnerTeamId !== null;
  const updated = await writeMatch(tx, m, {
    status: "PENDING",
    homeTeamId: null,
    awayTeamId: null,
    ...CLEARED_RUN_FIELDS,
    ...CLEARED_RESULT_FIELDS,
    ...(hadResult ? { resultRevision: { increment: 1 } } : {}),
  });
  await writeMatchEvent(tx, {
    tournamentId: ctx.tournament.id,
    matchId: m.id,
    type: "VOIDED",
    actorId: actor.id,
    payload: { reason, before: matchSnapshot(m) },
  });
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId: actor.id,
    action: "match.void",
    entityType: "Match",
    entityId: m.id,
    before: matchSnapshot(m),
    after: matchSnapshot(updated),
    reason,
  });
  return updated;
}

/**
 * Admin recovery wizard (one transaction): void downstream matches, reopen the
 * tournament phase, apply the corrected result, re-seed the bracket.
 */
export async function executeRecovery(
  actor: Actor,
  input: RecoveryInput,
  opts?: TxOptions,
): Promise<RecoveryOutcome> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 5);
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      if ((input.confirmText ?? "").trim() !== recoveryConfirmText(match.code)) {
        fail("CONFIRMATION_REQUIRED", `Bitte gib zur Bestätigung «${recoveryConfirmText(match.code)}» ein.`);
      }
      assertVersion(match, input.expectedVersion);
      if (!isDecidedStatus(match.status)) {
        fail("INVALID_STATE", "Nur bestätigte Resultate können korrigiert werden.");
      }
      const { codes, resetsKnockout } = await recoveryScope(
        tx,
        match,
        ctx.tournament.status,
        input.newResult,
      );
      const rows = await tx.match.findMany({
        where: { tournamentId: ctx.tournament.id, code: { in: codes } },
        select: { id: true },
      });
      await lockMatches(
        tx,
        rows.map((r) => r.id),
      );
      const fresh = await tx.match.findMany({
        where: { tournamentId: ctx.tournament.id, code: { in: codes } },
        orderBy: { orderIndex: "desc" }, // final backwards
      });
      for (const m of fresh) await voidMatch(tx, ctx, actor, m, reason);

      // Reopen the tournament phase.
      const before = await tx.tournament.findUniqueOrThrow({
        where: { id: ctx.tournament.id },
        select: { status: true, championTeamId: true },
      });
      let status = before.status;
      if (codes.length > 0 && status === "COMPLETED") {
        assertTransition(status, "KNOCKOUT_STAGE", { recovery: true });
        status = "KNOCKOUT_STAGE";
      }
      if (resetsKnockout && status === "KNOCKOUT_STAGE") {
        assertTransition(status, "GROUP_STAGE", { recovery: true });
        status = "GROUP_STAGE";
      }
      if (status !== before.status) {
        await tx.tournament.update({
          where: { id: ctx.tournament.id },
          data: { status, championTeamId: null },
        });
        ctx.tournament.status = status;
        await writeAudit(tx, {
          tournamentId: ctx.tournament.id,
          actorId: actor.id,
          action: "tournament.recovery",
          entityType: "Tournament",
          entityId: ctx.tournament.id,
          before,
          after: { status, championTeamId: null, voided: codes },
          reason,
        });
      }

      const current = await tx.match.findUniqueOrThrow({ where: { id: match.id } });
      const updated = await applyCorrection(tx, ctx, actor, current, input.newResult, reason, true);
      const { reseeded, championTeamId } = await propagate(tx, ctx, actor, updated, reason);
      return {
        matchId: updated.id,
        version: updated.version,
        resultRevision: updated.resultRevision,
        reseeded,
        championTeamId,
        voided: fresh.map((m) => m.code),
        tournamentStatus: ctx.tournament.status,
      };
    },
    opts,
  );
}
