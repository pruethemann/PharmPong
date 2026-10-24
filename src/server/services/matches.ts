// Match execution: table assignment, start, timer pause/resume, admin abort and
// issue reports. Shared low-level helpers (locking, versioned writes, team lock
// rows, snapshots) are exported for results.ts and corrections.ts.
//
// Concurrency: every mutation runs in withTournamentTx (tournament row lock),
// locks the match row, checks the client's expectedVersion and writes with
// `updateMany where {id, version}`. ActiveTeamMatch (PK teamId) and the partial
// unique index match_one_active_per_table are the final guards.
import { db, type Db, type Tx } from "@/server/db";
import { assertRole, isAdmin } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { assertMatchTransition } from "@/server/domain/match-state";
import { eligibility, suggestAssignments } from "@/server/domain/scheduler";
import { isPlayPhase } from "@/server/domain/tournament-state";
import type { Match, Prisma } from "@/generated/prisma/client";
import type { MatchStatus } from "@/generated/prisma/enums";
import { writeAudit, writeMatchEvent } from "./audit";
import { loadTournamentState } from "./state";
import { withTournamentTx, type TxContext, type TxOptions } from "./tx";

export type MatchMutationResult = { matchId: string; version: number; status: MatchStatus };

// ─── Shared helpers ────────────────────────────────────────────────────────

/** Tournament of a match (plain read before the tournament lock is taken). */
export async function matchTournamentId(matchId: string, client: Db = db): Promise<string> {
  const m = await client.match.findUnique({ where: { id: matchId }, select: { tournamentId: true } });
  if (!m) fail("NOT_FOUND", "Spiel nicht gefunden.");
  return m.tournamentId;
}

/** Lock and load one match row inside a tournament tx. */
export async function getLockedMatch(tx: Tx, ctx: TxContext, matchId: string): Promise<Match> {
  await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
  const m = await tx.match.findUnique({ where: { id: matchId } });
  if (!m || m.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Spiel nicht gefunden.");
  return m;
}

export function assertVersion(match: Match, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && match.version !== expectedVersion) {
    fail("STALE_VERSION", undefined, { expected: expectedVersion, actual: match.version });
  }
}

/** Optimistic write: only applies when the row still has `match.version`. Increments version. */
export async function writeMatch(
  tx: Tx,
  match: Match,
  data: Prisma.MatchUncheckedUpdateManyInput,
): Promise<Match> {
  const r = await tx.match.updateMany({
    where: { id: match.id, version: match.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (r.count !== 1) fail("STALE_VERSION");
  return tx.match.findUniqueOrThrow({ where: { id: match.id } });
}

/** Remove the per-team active-match lock rows of a match. */
export async function releaseTeamLocks(tx: Tx, matchId: string): Promise<number> {
  const r = await tx.activeTeamMatch.deleteMany({ where: { matchId } });
  return r.count;
}

export function assertPlayPhase(ctx: TxContext): void {
  if (!isPlayPhase(ctx.tournament.status)) {
    fail("INVALID_STATE", "Spiele können nur während der Gruppen- oder K.-o.-Phase gespielt werden.");
  }
}

export function assertNotPaused(ctx: TxContext): void {
  if (ctx.tournament.isPaused) fail("TOURNAMENT_PAUSED");
}

/**
 * Referees never officiate a match of their own team (one person must not be
 * able to start, record and confirm their own result). Admins are exempt.
 */
export async function assertNotOwnMatch(tx: Tx, actor: Actor, match: Match): Promise<void> {
  if (isAdmin(actor)) return;
  const teamIds = [match.homeTeamId, match.awayTeamId].filter((t): t is string => t !== null);
  if (teamIds.length === 0) return;
  const own = await tx.teamMember.count({
    where: { userId: actor.id, teamId: { in: teamIds }, leftAt: null },
  });
  if (own > 0) {
    fail(
      "FORBIDDEN",
      "Du kannst kein Spiel deines eigenen Teams leiten. Bitte eine andere Schiedsrichter:in.",
    );
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** JSON-safe snapshot of the mutable match fields (audit before/after). */
export function matchSnapshot(m: Match) {
  return {
    code: m.code,
    status: m.status,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    tableId: m.tableId,
    refereeId: m.refereeId,
    assignedAt: iso(m.assignedAt),
    startedAt: iso(m.startedAt),
    pausedAt: iso(m.pausedAt),
    pausedDurationMs: m.pausedDurationMs,
    endedAt: iso(m.endedAt),
    winnerTeamId: m.winnerTeamId,
    homeCupsRemaining: m.homeCupsRemaining,
    awayCupsRemaining: m.awayCupsRemaining,
    endType: m.endType,
    resultRevision: m.resultRevision,
    proposedAt: iso(m.proposedAt),
    proposedById: m.proposedById,
    confirmedAt: iso(m.confirmedAt),
    confirmedById: m.confirmedById,
    version: m.version,
  };
}

export const mutationResult = (m: Match): MatchMutationResult => ({
  matchId: m.id,
  version: m.version,
  status: m.status,
});

/** Fields cleared when a match leaves the table without a result (unassign/abort/void). */
export const CLEARED_RUN_FIELDS = {
  tableId: null,
  assignedAt: null,
  startedAt: null,
  pausedAt: null,
  pausedDurationMs: 0,
  endedAt: null,
  refereeId: null,
} satisfies Prisma.MatchUncheckedUpdateManyInput;

export const CLEARED_RESULT_FIELDS = {
  winnerTeamId: null,
  homeCupsRemaining: null,
  awayCupsRemaining: null,
  endType: null,
  proposedAt: null,
  proposedById: null,
  confirmedAt: null,
  confirmedById: null,
} satisfies Prisma.MatchUncheckedUpdateManyInput;

/** Fold a running pause into pausedDurationMs (used before ending the clock). */
export function foldPause(m: Match, now: Date): { pausedAt: null; pausedDurationMs: number } {
  const extra = m.pausedAt ? Math.max(0, now.getTime() - m.pausedAt.getTime()) : 0;
  return { pausedAt: null, pausedDurationMs: m.pausedDurationMs + extra };
}

function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
}

export function assertReason(raw: unknown, min: number, field = "reason"): string {
  const reason = cleanText(raw);
  if (reason.length < min || reason.length > 500) {
    fail("VALIDATION", `Bitte gib eine Begründung mit mindestens ${min} Zeichen an.`, { field });
  }
  return reason;
}

type Mutation<T> = (tx: Tx, ctx: TxContext, actor: Actor) => Promise<T>;

/** Resolve the match's tournament and run `fn` inside its tournament transaction. */
export async function inMatchTx<T>(
  actor: Actor,
  matchId: string,
  fn: Mutation<T>,
  opts: TxOptions = {},
): Promise<T> {
  const tournamentId = await matchTournamentId(matchId, opts.client);
  return withTournamentTx(tournamentId, (tx, ctx) => fn(tx, ctx, actor), opts);
}

// ─── Assignment ────────────────────────────────────────────────────────────

export type AssignInput = { matchId: string; tableId: string; expectedVersion: number };

/**
 * Assign a READY match to a table. Referees may only take the scheduler's
 * suggestion for that table; admins may assign any READY match whose teams are free.
 */
export async function assignMatch(
  actor: Actor,
  input: AssignInput,
  opts?: TxOptions,
): Promise<MatchMutationResult & { tableId: string; override: boolean }> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      assertPlayPhase(ctx);
      assertNotPaused(ctx);
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);

      const table = await tx.gameTable.findUnique({ where: { id: input.tableId } });
      if (!table || table.tournamentId !== ctx.tournament.id) fail("NOT_FOUND", "Tisch nicht gefunden.");
      if (table.isDisabled) fail("TABLE_DISABLED");
      assertMatchTransition(match.status, "ASSIGNED");

      const state = await loadTournamentState(tx, ctx.tournament.id);
      const occupied = state.matches.some(
        (m) =>
          m.id !== match.id &&
          m.tableId === table.id &&
          ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"].includes(m.status),
      );
      if (occupied) fail("TABLE_BUSY");
      const view = state.matches.find((m) => m.id === match.id)!;
      const elig = eligibility(state.matches, view);
      if (!elig.eligible) {
        if (elig.reason === "TEAM_BUSY") fail("TEAM_BUSY");
        fail("INVALID_STATE", "Dieses Spiel kann noch nicht zugewiesen werden.", { reason: elig.reason });
      }
      const suggested = suggestAssignments(state.matches, state.tables).some(
        (s) => s.matchId === match.id && s.tableId === table.id,
      );
      if (!suggested && !isAdmin(actor)) {
        fail("FORBIDDEN", "Schiedsrichter:innen können nur das vorgeschlagene Spiel zuweisen.");
      }

      // Lock rows first: the PK on teamId rejects a team that is already active elsewhere.
      await tx.activeTeamMatch.createMany({
        data: [match.homeTeamId!, match.awayTeamId!].map((teamId) => ({
          teamId,
          matchId: match.id,
          tournamentId: ctx.tournament.id,
        })),
      });
      const updated = await writeMatch(tx, match, {
        status: "ASSIGNED",
        tableId: table.id,
        assignedAt: ctx.now,
      });
      const override = !suggested;
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "ASSIGNED",
        actorId: actor.id,
        payload: { tableId: table.id, tableNumber: table.number, override },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.assign",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: { ...matchSnapshot(updated), override },
      });
      return { ...mutationResult(updated), tableId: table.id, override };
    },
    opts,
  );
}

export type VersionedInput = { matchId: string; expectedVersion: number };

/**
 * ASSIGNED → READY. Referees and admins; only before the match was started.
 * Referees cannot undo an admin override assignment.
 */
export async function unassignMatch(
  actor: Actor,
  input: VersionedInput,
  opts?: TxOptions,
): Promise<MatchMutationResult> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      if (match.status !== "ASSIGNED" || match.startedAt) {
        fail("INVALID_STATE", "Nur zugewiesene, noch nicht gestartete Spiele können freigegeben werden.");
      }
      assertMatchTransition(match.status, "READY");
      if (!isAdmin(actor)) {
        // An admin override (non-suggested match) may only be undone by an admin.
        const assigned = await tx.matchEvent.findFirst({
          where: { matchId: match.id, type: "ASSIGNED" },
          orderBy: { createdAt: "desc" },
          select: { payload: true },
        });
        const payload = assigned?.payload as { override?: unknown } | null | undefined;
        if (payload?.override === true) {
          fail("FORBIDDEN", "Diese Zuweisung hat die Turnierleitung festgelegt. Nur sie kann sie aufheben.");
        }
      }
      await releaseTeamLocks(tx, match.id);
      const updated = await writeMatch(tx, match, { status: "READY", tableId: null, assignedAt: null });
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "UNASSIGNED",
        actorId: actor.id,
        payload: { tableId: match.tableId },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.unassign",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: matchSnapshot(updated),
      });
      return mutationResult(updated);
    },
    opts,
  );
}

// ─── Clock ─────────────────────────────────────────────────────────────────

/** ASSIGNED → IN_PROGRESS; the clock starts at the DB time of this transaction. */
export async function startMatch(
  actor: Actor,
  input: VersionedInput,
  opts?: TxOptions,
): Promise<MatchMutationResult & { startedAt: string }> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      assertPlayPhase(ctx);
      assertNotPaused(ctx);
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      assertMatchTransition(match.status, "IN_PROGRESS");
      await assertNotOwnMatch(tx, actor, match);
      const updated = await writeMatch(tx, match, {
        status: "IN_PROGRESS",
        startedAt: ctx.now,
        pausedAt: null,
        pausedDurationMs: 0,
        endedAt: null,
        refereeId: actor.id,
      });
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "STARTED",
        actorId: actor.id,
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.start",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: matchSnapshot(updated),
      });
      return { ...mutationResult(updated), startedAt: ctx.now.toISOString() };
    },
    opts,
  );
}

export async function pauseMatch(
  actor: Actor,
  input: VersionedInput,
  opts?: TxOptions,
): Promise<MatchMutationResult> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      if (match.status !== "IN_PROGRESS" || match.pausedAt) {
        fail("INVALID_STATE", "Nur ein laufendes Spiel kann pausiert werden.");
      }
      const updated = await writeMatch(tx, match, { pausedAt: ctx.now });
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "PAUSED",
        actorId: actor.id,
      });
      return mutationResult(updated);
    },
    opts,
  );
}

export async function resumeMatch(
  actor: Actor,
  input: VersionedInput,
  opts?: TxOptions,
): Promise<MatchMutationResult & { pausedDurationMs: number }> {
  assertRole(actor, "REFEREE");
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      // The tournament-wide resume decides which matches continue.
      assertNotPaused(ctx);
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      if (match.status !== "IN_PROGRESS" || !match.pausedAt) {
        fail("INVALID_STATE", "Dieses Spiel ist nicht pausiert.");
      }
      const updated = await writeMatch(tx, match, foldPause(match, ctx.now));
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "RESUMED",
        actorId: actor.id,
        payload: { pausedMs: updated.pausedDurationMs - match.pausedDurationMs },
      });
      return { ...mutationResult(updated), pausedDurationMs: updated.pausedDurationMs };
    },
    opts,
  );
}

// ─── Admin recovery: abort ─────────────────────────────────────────────────

export type AbortInput = { matchId: string; reason: string; expectedVersion?: number };

/**
 * Admin: take an active match (started by mistake, wrong table, ...) back to READY.
 * Clears the table, the clock and any proposal. Recovery transition.
 */
export async function abortMatch(
  actor: Actor,
  input: AbortInput,
  opts?: TxOptions,
): Promise<MatchMutationResult> {
  assertRole(actor, "ADMIN");
  const reason = assertReason(input.reason, 3);
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      assertVersion(match, input.expectedVersion);
      if (!["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"].includes(match.status)) {
        fail("INVALID_STATE", "Nur zugewiesene oder laufende Spiele können abgebrochen werden.");
      }
      assertMatchTransition(match.status, "READY", { recovery: true });
      await releaseTeamLocks(tx, match.id);
      const updated = await writeMatch(tx, match, {
        status: "READY",
        ...CLEARED_RUN_FIELDS,
        ...CLEARED_RESULT_FIELDS,
      });
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "ABORTED",
        actorId: actor.id,
        payload: { reason, from: match.status },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.abort",
        entityType: "Match",
        entityId: match.id,
        before: matchSnapshot(match),
        after: matchSnapshot(updated),
        reason,
      });
      return mutationResult(updated);
    },
    opts,
  );
}

// ─── Issues ────────────────────────────────────────────────────────────────

/** A match has an open issue when its latest ISSUE_REPORTED is newer than its latest ISSUE_RESOLVED. */
export async function hasOpenIssue(client: Db | Tx, matchId: string): Promise<boolean> {
  const [reported, resolved] = await Promise.all([
    client.matchEvent.findFirst({
      where: { matchId, type: "ISSUE_REPORTED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    client.matchEvent.findFirst({
      where: { matchId, type: "ISSUE_RESOLVED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  if (!reported) return false;
  return !resolved || reported.createdAt.getTime() > resolved.createdAt.getTime();
}

export async function reportIssue(
  actor: Actor,
  input: { matchId: string; text: string },
  opts?: TxOptions,
): Promise<{ matchId: string; open: true }> {
  assertRole(actor, "REFEREE");
  const text = cleanText(input.text);
  if (text.length < 3 || text.length > 300) {
    fail("VALIDATION", "Bitte beschreibe das Problem in 3 bis 300 Zeichen.", { field: "text" });
  }
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "ISSUE_REPORTED",
        actorId: actor.id,
        payload: { text },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.issue_report",
        entityType: "Match",
        entityId: match.id,
        after: { text, status: match.status },
      });
      return { matchId: match.id, open: true as const };
    },
    opts,
  );
}

export async function resolveIssue(
  actor: Actor,
  input: { matchId: string; note?: string | null },
  opts?: TxOptions,
): Promise<{ matchId: string; open: false }> {
  assertRole(actor, "ADMIN");
  const note = cleanText(input.note ?? "");
  if (note.length > 300) {
    fail("VALIDATION", "Die Notiz darf höchstens 300 Zeichen lang sein.", { field: "note" });
  }
  return inMatchTx(
    actor,
    input.matchId,
    async (tx, ctx) => {
      const match = await getLockedMatch(tx, ctx, input.matchId);
      if (!(await hasOpenIssue(tx, match.id))) {
        fail("INVALID_STATE", "Für dieses Spiel ist kein Problem offen.");
      }
      await writeMatchEvent(tx, {
        tournamentId: ctx.tournament.id,
        matchId: match.id,
        type: "ISSUE_RESOLVED",
        actorId: actor.id,
        payload: { note: note || null },
      });
      await writeAudit(tx, {
        tournamentId: ctx.tournament.id,
        actorId: actor.id,
        action: "match.issue_resolve",
        entityType: "Match",
        entityId: match.id,
        after: { note: note || null },
      });
      return { matchId: match.id, open: false as const };
    },
    opts,
  );
}
