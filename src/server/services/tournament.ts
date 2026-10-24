// Tournament lifecycle: settings, registration phases, draw (and audited reset),
// group/knockout stage transitions, tournament-wide pause and cancellation.
// Every mutation: assertRole → withTournamentTx (row lock, DB clock, revision
// bump) → validated transition → writes with optimistic Match.version checks →
// AuditLog (+ MatchEvents where matches change).
import { db, type Db, type Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { resolveQuarterfinals, type QuarterfinalCode } from "@/server/domain/bracket";
import { drawGroups, secureRng, TEAM_COUNT, type Rng } from "@/server/domain/draw";
import { fail } from "@/server/domain/errors";
import { assertMatchTransition, isDecidedStatus } from "@/server/domain/match-state";
import { assertTransition } from "@/server/domain/tournament-state";
import { GROUP_NAMES, type GroupName } from "@/server/domain/types";
import type { MatchStatus, TournamentStatus } from "@/generated/prisma/enums";
import { writeAudit, writeMatchEvent } from "./audit";
import { loadTournamentState, lockMatches } from "./state";
import { getCurrentTournamentId, withTournamentTx, type TxContext } from "./tx";

export type ServiceOpts = { tournamentId?: string; client?: Db };

export const CANCEL_CONFIRM_TEXT = "TURNIER ABBRECHEN";
export const RESET_DRAW_CONFIRM_TEXT = "AUSLOSUNG ZURÜCKSETZEN";
export const MATCH_DURATION_MIN_SEC = 300;
export const MATCH_DURATION_MAX_SEC = 3600;
export const TOURNAMENT_NAME_MAX = 80;
export const RESET_REASON_MIN = 5;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

const TERMINAL: readonly TournamentStatus[] = ["COMPLETED", "CANCELLED"];
const RESETTABLE: readonly TournamentStatus[] = ["REGISTRATION_LOCKED", "GROUP_STAGE", "KNOCKOUT_STAGE"];
const DONE_MATCH: readonly MatchStatus[] = ["COMPLETED", "FORFEITED", "CANCELLED"];

// ─── Helpers ───────────────────────────────────────────────────────────────

export async function resolveTournamentId(opts?: ServiceOpts): Promise<string> {
  const id = opts?.tournamentId ?? (await getCurrentTournamentId(opts?.client ?? db));
  if (!id) fail("NOT_FOUND", "Kein Turnier gefunden.");
  return id;
}

function txOpts(opts?: ServiceOpts) {
  return opts?.client ? { client: opts.client } : {};
}

function assertReason(reason: unknown, min = REASON_MIN): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < min || r.length > REASON_MAX) {
    fail("VALIDATION", `Bitte gib eine Begründung mit ${min}–${REASON_MAX} Zeichen an.`, { field: "reason" });
  }
  return r;
}

async function setStatus(
  tx: Tx,
  ctx: TxContext,
  actor: Actor,
  to: TournamentStatus,
  action: string,
  extra: Record<string, unknown> = {},
  reason?: string,
) {
  const from = ctx.tournament.status;
  assertTransition(from, to);
  await tx.tournament.update({ where: { id: ctx.tournament.id }, data: { status: to, ...extra } });
  await writeAudit(tx, {
    tournamentId: ctx.tournament.id,
    actorId: actor.id,
    action,
    entityType: "Tournament",
    entityId: ctx.tournament.id,
    before: { status: from },
    after: { status: to, ...extra },
    reason: reason ?? null,
  });
  ctx.tournament.status = to;
}

/** ACTIVE teams with their active members, split into eligible (exactly 2) and incomplete. */
async function teamEligibility(client: Db | Tx, tournamentId: string) {
  const teams = await client.team.findMany({
    where: { tournamentId, status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      members: { where: { leftAt: null }, select: { userId: true } },
    },
  });
  const eligible = teams.filter((t) => t.members.length === 2);
  const incomplete = teams.filter((t) => t.members.length !== 2);
  return { teams, eligible, incomplete };
}

/** Full JSON snapshot of the draw: groups, assignments, tiebreaks, matches with results and events. */
async function drawSnapshot(tx: Tx, tournamentId: string) {
  const [groups, matches] = await Promise.all([
    tx.group.findMany({
      where: { tournamentId },
      orderBy: { name: "asc" },
      include: {
        assignments: { orderBy: { position: "asc" } },
        tiebreaks: { orderBy: { createdAt: "asc" } },
      },
    }),
    tx.match.findMany({
      where: { tournamentId },
      orderBy: { orderIndex: "asc" },
      include: { events: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  return {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      assignments: g.assignments.map((a) => ({ teamId: a.teamId, position: a.position })),
      tiebreaks: g.tiebreaks,
    })),
    matches,
  };
}

async function deleteDraw(tx: Tx, tournamentId: string) {
  await tx.activeTeamMatch.deleteMany({ where: { tournamentId } });
  await tx.match.updateMany({ where: { tournamentId }, data: { nextMatchId: null } });
  await tx.match.deleteMany({ where: { tournamentId } });
  await tx.group.deleteMany({ where: { tournamentId } });
}

/** Optimistic match write: fails with STALE_VERSION when the row changed meanwhile. */
async function updateMatchVersioned(
  tx: Tx,
  id: string,
  expectedVersion: number,
  data: Parameters<Tx["match"]["updateMany"]>[0]["data"],
) {
  const r = await tx.match.updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (r.count !== 1) fail("STALE_VERSION");
}

// ─── Read helper ───────────────────────────────────────────────────────────

export type TournamentOverview = {
  id: string;
  name: string;
  status: TournamentStatus;
  isPaused: boolean;
  pausedAt: Date | null;
  revision: number;
  matchDurationSec: number;
  bombRuleEnabled: boolean;
  publicDisplayEnabled: boolean;
  drawGeneratedAt: Date | null;
  rosterLockedAt: Date | null;
  championTeamId: string | null;
  counts: {
    /** Active users with role PLAYER. */
    registeredPlayers: number;
    /** Active members of ACTIVE teams. */
    players: number;
    teams: number;
    completeTeams: number;
    incompleteTeams: number;
    eligibleTeams: number;
    requiredTeams: number;
    matches: Record<MatchStatus, number>;
  };
};

export async function getTournamentOverview(
  tournamentId?: string,
  client: Db = db,
): Promise<TournamentOverview | null> {
  const id = tournamentId ?? (await getCurrentTournamentId(client));
  if (!id) return null;
  const t = await client.tournament.findUnique({ where: { id } });
  if (!t) return null;
  const [{ teams, eligible, incomplete }, registeredPlayers, byStatus] = await Promise.all([
    teamEligibility(client, id),
    client.user.count({ where: { role: "PLAYER", isActive: true } }),
    client.match.groupBy({ by: ["status"], where: { tournamentId: id }, _count: { _all: true } }),
  ]);
  const matches = {
    PENDING: 0,
    READY: 0,
    ASSIGNED: 0,
    IN_PROGRESS: 0,
    AWAITING_CONFIRMATION: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    FORFEITED: 0,
  } as Record<MatchStatus, number>;
  for (const row of byStatus) matches[row.status] = row._count._all;
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    isPaused: t.isPaused,
    pausedAt: t.pausedAt,
    revision: t.revision,
    matchDurationSec: t.matchDurationSec,
    bombRuleEnabled: t.bombRuleEnabled,
    publicDisplayEnabled: t.publicDisplayEnabled,
    drawGeneratedAt: t.drawGeneratedAt,
    rosterLockedAt: t.rosterLockedAt,
    championTeamId: t.championTeamId,
    counts: {
      registeredPlayers,
      players: teams.reduce((n, x) => n + x.members.length, 0),
      teams: teams.length,
      completeTeams: eligible.length,
      incompleteTeams: incomplete.length,
      eligibleTeams: eligible.length,
      requiredTeams: TEAM_COUNT,
      matches,
    },
  };
}

// ─── Settings ──────────────────────────────────────────────────────────────

export type SettingsInput = {
  name?: string;
  matchDurationSec?: number;
  bombRuleEnabled?: boolean;
  publicDisplayEnabled?: boolean;
};

export async function updateSettings(actor: Actor, input: SettingsInput, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const data: SettingsInput = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > TOURNAMENT_NAME_MAX) {
      fail("VALIDATION", `Der Turniername muss 2–${TOURNAMENT_NAME_MAX} Zeichen lang sein.`, {
        field: "name",
      });
    }
    data.name = name;
  }
  if (input.matchDurationSec !== undefined) {
    const d = input.matchDurationSec;
    if (!Number.isInteger(d) || d < MATCH_DURATION_MIN_SEC || d > MATCH_DURATION_MAX_SEC) {
      fail(
        "VALIDATION",
        `Die Spieldauer muss zwischen ${MATCH_DURATION_MIN_SEC / 60} und ${MATCH_DURATION_MAX_SEC / 60} Minuten liegen.`,
        { field: "matchDurationSec" },
      );
    }
    data.matchDurationSec = d;
  }
  if (input.bombRuleEnabled !== undefined) data.bombRuleEnabled = !!input.bombRuleEnabled;
  if (input.publicDisplayEnabled !== undefined) data.publicDisplayEnabled = !!input.publicDisplayEnabled;
  const tournamentId = await resolveTournamentId(opts);

  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (TERMINAL.includes(ctx.tournament.status)) fail("INVALID_STATE", "Das Turnier ist bereits beendet.");
      const before = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { name: true, matchDurationSec: true, bombRuleEnabled: true, publicDisplayEnabled: true },
      });
      if (data.matchDurationSec !== undefined && data.matchDurationSec !== before.matchDurationSec) {
        // AWAITING_CONFIRMATION counts too: a rejected proposal continues the same clock.
        const running = await tx.match.count({
          where: { tournamentId, status: { in: ["IN_PROGRESS", "AWAITING_CONFIRMATION"] } },
        });
        if (running > 0) {
          fail("INVALID_STATE", "Die Spieldauer kann nicht geändert werden, solange ein Spiel läuft.");
        }
      }
      const after = await tx.tournament.update({
        where: { id: tournamentId },
        data,
        select: { name: true, matchDurationSec: true, bombRuleEnabled: true, publicDisplayEnabled: true },
      });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.update_settings",
        entityType: "Tournament",
        entityId: tournamentId,
        before,
        after,
      });
      return after;
    },
    txOpts(opts),
  );
}

// ─── Registration phases ───────────────────────────────────────────────────

export async function openRegistration(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      // REGISTRATION_LOCKED → OPEN is a separate action (reopenRegistration).
      if (ctx.tournament.status !== "DRAFT") {
        fail("INVALID_TRANSITION", "Die Anmeldung kann nur aus dem Entwurf geöffnet werden.", {
          from: ctx.tournament.status,
          to: "REGISTRATION_OPEN",
        });
      }
      await setStatus(tx, ctx, actor, "REGISTRATION_OPEN", "tournament.open_registration");
      return { status: ctx.tournament.status };
    },
    txOpts(opts),
  );
}

export async function lockRegistration(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      await setStatus(tx, ctx, actor, "REGISTRATION_LOCKED", "tournament.lock_registration", {
        rosterLockedAt: ctx.now,
      });
      return { status: ctx.tournament.status };
    },
    txOpts(opts),
  );
}

export async function reopenRegistration(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status !== "REGISTRATION_LOCKED") {
        fail("INVALID_TRANSITION", "Die Anmeldung kann nur nach dem Sperren wieder geöffnet werden.");
      }
      const groups = await tx.group.count({ where: { tournamentId } });
      if (groups > 0) {
        fail("INVALID_STATE", "Es gibt bereits eine Auslosung. Setze sie zuerst zurück.");
      }
      await setStatus(tx, ctx, actor, "REGISTRATION_OPEN", "tournament.reopen_registration", {
        rosterLockedAt: null,
      });
      return { status: ctx.tournament.status };
    },
    txOpts(opts),
  );
}

export async function cancelTournament(
  actor: Actor,
  input: { reason: string; confirmText: string },
  opts?: ServiceOpts,
) {
  assertRole(actor, "ADMIN");
  if (input.confirmText !== CANCEL_CONFIRM_TEXT) {
    fail("CONFIRMATION_REQUIRED", `Bitte tippe «${CANCEL_CONFIRM_TEXT}» zur Bestätigung.`);
  }
  const reason = assertReason(input.reason);
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      assertTransition(ctx.tournament.status, "CANCELLED");
      const open = await tx.match.findMany({
        where: { tournamentId, status: { notIn: [...DONE_MATCH] } },
        orderBy: { orderIndex: "asc" },
        select: { id: true, code: true, status: true },
      });
      await lockMatches(
        tx,
        open.map((m) => m.id),
      );
      for (const m of open) assertMatchTransition(m.status, "CANCELLED");
      await tx.match.updateMany({
        where: { id: { in: open.map((m) => m.id) } },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      await tx.activeTeamMatch.deleteMany({ where: { tournamentId } });
      await setStatus(
        tx,
        ctx,
        actor,
        "CANCELLED",
        "tournament.cancel",
        { isPaused: false, pausedAt: null },
        reason,
      );
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "match.cancel_all",
        entityType: "Tournament",
        entityId: tournamentId,
        before: { matches: open },
        after: { status: "CANCELLED", count: open.length },
        reason,
      });
      return { status: ctx.tournament.status, cancelledMatches: open.length };
    },
    txOpts(opts),
  );
}

// ─── Draw ──────────────────────────────────────────────────────────────────

export type DrawGroupView = {
  name: GroupName;
  teams: { id: string; name: string; position: number }[];
};

export async function generateDraw(
  actor: Actor,
  input: { rng?: Rng } = {},
  opts?: ServiceOpts,
): Promise<{ groups: DrawGroupView[]; redraw: boolean }> {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status !== "REGISTRATION_LOCKED") {
        fail(
          "INVALID_STATE",
          ctx.tournament.status === "GROUP_STAGE" || ctx.tournament.status === "KNOCKOUT_STAGE"
            ? "Nach dem Start der Gruppenphase ist eine neue Auslosung nur über «Auslosung zurücksetzen» möglich."
            : "Die Auslosung ist nur bei gesperrter Anmeldung möglich.",
          { status: ctx.tournament.status },
        );
      }
      const { eligible, incomplete } = await teamEligibility(tx, tournamentId);
      if (incomplete.length > 0) {
        fail(
          "VALIDATION",
          `Folgende Teams sind unvollständig: ${incomplete.map((t) => t.name).join(", ")}. Bitte zuerst ergänzen oder auflösen.`,
          { incompleteTeams: incomplete.map((t) => ({ id: t.id, name: t.name })) },
        );
      }
      if (eligible.length !== TEAM_COUNT) {
        fail(
          "WRONG_TEAM_COUNT",
          `Für die Auslosung braucht es genau ${TEAM_COUNT} vollständige Teams (aktuell ${eligible.length}).`,
          {
            count: eligible.length,
          },
        );
      }

      // Redraw before the group stage: replace the previous fixtures.
      const existingGroups = await tx.group.count({ where: { tournamentId } });
      const existingMatches = await tx.match.count({ where: { tournamentId } });
      let previous: Awaited<ReturnType<typeof drawSnapshot>> | null = null;
      if (existingGroups > 0 || existingMatches > 0) {
        const played = await tx.match.count({ where: { tournamentId, status: { not: "PENDING" } } });
        if (played > 0)
          fail(
            "INVALID_STATE",
            "Es wurden bereits Spiele freigegeben. Bitte «Auslosung zurücksetzen» verwenden.",
          );
        previous = await drawSnapshot(tx, tournamentId);
        await deleteDraw(tx, tournamentId);
      }

      const teamIds = eligible.map((t) => t.id).sort();
      const draw = drawGroups(teamIds, input.rng ?? secureRng);
      const nameById = new Map(eligible.map((t) => [t.id, t.name]));

      const groupIdByName = new Map<GroupName, string>();
      for (const name of GROUP_NAMES) {
        const g = await tx.group.create({
          data: {
            tournamentId,
            name,
            assignments: { create: draw.groups[name].map((teamId, i) => ({ teamId, position: i + 1 })) },
          },
        });
        groupIdByName.set(name, g.id);
      }

      const matchIdByCode = new Map<string, string>();
      for (const f of draw.fixtures) {
        const m = await tx.match.create({
          data: {
            tournamentId,
            code: f.code,
            stage: f.stage,
            round: f.round,
            orderIndex: f.orderIndex,
            groupId: f.group ? groupIdByName.get(f.group)! : null,
            homeTeamId: f.homeTeamId,
            awayTeamId: f.awayTeamId,
            homeSource: f.homeSource,
            awaySource: f.awaySource,
            status: "PENDING",
          },
          select: { id: true },
        });
        matchIdByCode.set(f.code, m.id);
      }
      for (const f of draw.fixtures) {
        if (!f.nextCode) continue;
        await tx.match.update({
          where: { id: matchIdByCode.get(f.code)! },
          data: { nextMatchId: matchIdByCode.get(f.nextCode)!, nextSlot: f.nextSlot },
        });
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { drawGeneratedAt: ctx.now } });

      const groups: DrawGroupView[] = GROUP_NAMES.map((name) => ({
        name,
        teams: draw.groups[name].map((id, i) => ({ id, name: nameById.get(id) ?? "", position: i + 1 })),
      }));
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: previous ? "tournament.redraw" : "tournament.draw",
        entityType: "Tournament",
        entityId: tournamentId,
        before: previous ? { groups: previous.groups, matchCount: previous.matches.length } : undefined,
        after: { groups, matchCount: draw.fixtures.length },
      });
      return { groups, redraw: previous !== null };
    },
    txOpts(opts),
  );
}

export async function startGroupStage(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      assertTransition(ctx.tournament.status, "GROUP_STAGE");
      const [groups, matches] = await Promise.all([
        tx.group.findMany({
          where: { tournamentId },
          include: { assignments: { include: { team: { select: { id: true, name: true, status: true } } } } },
        }),
        tx.match.findMany({ where: { tournamentId }, select: { id: true, stage: true, status: true } }),
      ]);
      if (groups.length !== GROUP_NAMES.length || matches.length !== 19) {
        fail("INVALID_STATE", "Bitte zuerst die Gruppen auslosen.");
      }
      // Rosters may have been repaired after the draw; every drawn team must still be playable.
      const { eligible } = await teamEligibility(tx, tournamentId);
      const eligibleIds = new Set(eligible.map((t) => t.id));
      const broken = groups
        .flatMap((g) => g.assignments.map((a) => a.team))
        .filter((t) => !eligibleIds.has(t.id));
      if (broken.length > 0) {
        fail(
          "VALIDATION",
          `Folgende ausgeloste Teams sind nicht mehr vollständig: ${broken.map((t) => t.name).join(", ")}.`,
          { teams: broken.map((t) => ({ id: t.id, name: t.name })) },
        );
      }
      const groupMatches = matches.filter((m) => m.stage === "GROUP");
      for (const m of groupMatches) assertMatchTransition(m.status, "READY");
      const r = await tx.match.updateMany({
        where: { tournamentId, stage: "GROUP", status: "PENDING" },
        data: { status: "READY", version: { increment: 1 } },
      });
      if (r.count !== groupMatches.length) fail("STALE_VERSION");
      await setStatus(tx, ctx, actor, "GROUP_STAGE", "tournament.start_group_stage", {}, undefined);
      return { status: ctx.tournament.status, readyMatches: r.count };
    },
    txOpts(opts),
  );
}

/**
 * Explicit, audited reset of the draw. The AuditLog "before" holds a full
 * snapshot (groups, assignments, tiebreaks, all matches with results and their
 * MatchEvents); then groups/matches are deleted and the tournament returns to
 * REGISTRATION_LOCKED, ready for a new draw.
 */
export async function resetDraw(
  actor: Actor,
  input: { reason: string; confirmText: string },
  opts?: ServiceOpts,
) {
  assertRole(actor, "ADMIN");
  if (input.confirmText !== RESET_DRAW_CONFIRM_TEXT) {
    fail("CONFIRMATION_REQUIRED", `Bitte tippe «${RESET_DRAW_CONFIRM_TEXT}» zur Bestätigung.`);
  }
  const reason = assertReason(input.reason, RESET_REASON_MIN);
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      const from = ctx.tournament.status;
      if (!RESETTABLE.includes(from)) {
        fail("INVALID_TRANSITION", "Die Auslosung kann in dieser Turnierphase nicht zurückgesetzt werden.", {
          from,
        });
      }
      const snapshot = await drawSnapshot(tx, tournamentId);
      if (snapshot.groups.length === 0 && snapshot.matches.length === 0) {
        fail("INVALID_STATE", "Es gibt keine Auslosung zum Zurücksetzen.");
      }
      const t = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { status: true, isPaused: true, pausedAt: true, championTeamId: true, drawGeneratedAt: true },
      });
      const allIds = snapshot.matches.map((m) => m.id);
      await lockMatches(tx, allIds);
      await deleteDraw(tx, tournamentId);
      const after = {
        status: "REGISTRATION_LOCKED" as const,
        isPaused: false,
        pausedAt: null,
        championTeamId: null,
        drawGeneratedAt: null,
      };
      await tx.tournament.update({ where: { id: tournamentId }, data: after });
      ctx.tournament.status = "REGISTRATION_LOCKED";
      ctx.tournament.isPaused = false;
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.reset_draw",
        entityType: "Tournament",
        entityId: tournamentId,
        before: { tournament: t, ...snapshot },
        after,
        reason,
      });
      return { status: ctx.tournament.status, archivedMatches: snapshot.matches.length };
    },
    txOpts(opts),
  );
}

// ─── Knockout ──────────────────────────────────────────────────────────────

export async function startKnockout(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      assertTransition(ctx.tournament.status, "KNOCKOUT_STAGE");
      const state = await loadTournamentState(tx, tournamentId);
      const groupMatches = state.matches.filter((m) => m.stage === "GROUP");
      const undecided = groupMatches.filter((m) => !isDecidedStatus(m.status) || !m.result);
      if (groupMatches.length !== 12 || undecided.length > 0) {
        fail("GROUPS_INCOMPLETE", undefined, { pending: undecided.map((m) => m.code) });
      }
      const ties = state.standings.flatMap((s) => s.unresolved);
      if (ties.length > 0) {
        const names = [...new Set(ties.map((t) => t.group))].join(", ");
        fail(
          "UNRESOLVED_TIE",
          `Gleichstand in Gruppe ${names}: Bitte zuerst den Ranking-Shootout erfassen.`,
          {
            ties,
          },
        );
      }
      if (!state.qualifiers) fail("GROUPS_INCOMPLETE");
      const pairs = resolveQuarterfinals(state.qualifiers);
      const qfs = (Object.keys(pairs) as QuarterfinalCode[]).map((code) => {
        const m = state.matches.find((x) => x.code === code);
        if (!m) fail("INVALID_STATE", `Spiel ${code} fehlt.`);
        return { code, m, pair: pairs[code] };
      });
      await lockMatches(
        tx,
        qfs.map((q) => q.m.id),
      );
      for (const { code, m, pair } of qfs) {
        assertMatchTransition(m.status, "READY");
        await updateMatchVersioned(tx, m.id, m.row.version, {
          homeTeamId: pair.home,
          awayTeamId: pair.away,
          status: "READY",
        });
        for (const [teamId, slot] of [
          [pair.home, "HOME"],
          [pair.away, "AWAY"],
        ] as const) {
          await writeMatchEvent(tx, {
            tournamentId,
            matchId: m.id,
            type: "ADVANCED",
            actorId: actor.id,
            payload: { teamId, toCode: code, slot },
          });
        }
      }
      await setStatus(tx, ctx, actor, "KNOCKOUT_STAGE", "tournament.start_knockout", {});
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.seed_quarterfinals",
        entityType: "Tournament",
        entityId: tournamentId,
        after: { qualifiers: state.qualifiers, quarterfinals: pairs },
      });
      return { status: ctx.tournament.status, quarterfinals: pairs };
    },
    txOpts(opts),
  );
}

// ─── Tournament pause ──────────────────────────────────────────────────────

export async function pauseTournament(actor: Actor, input: { reason?: string } = {}, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const reason = input.reason?.trim() || null;
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status !== "GROUP_STAGE" && ctx.tournament.status !== "KNOCKOUT_STAGE") {
        fail("INVALID_STATE", "Pausieren ist nur während der Gruppen- oder K.-o.-Phase möglich.");
      }
      if (ctx.tournament.isPaused) fail("INVALID_STATE", "Das Turnier ist bereits pausiert.");
      const running = await tx.match.findMany({
        where: { tournamentId, status: "IN_PROGRESS", pausedAt: null },
        orderBy: { orderIndex: "asc" },
        select: { id: true, code: true, version: true },
      });
      await lockMatches(
        tx,
        running.map((m) => m.id),
      );
      for (const m of running) {
        await updateMatchVersioned(tx, m.id, m.version, { pausedAt: ctx.now });
        await writeMatchEvent(tx, {
          tournamentId,
          matchId: m.id,
          type: "PAUSED",
          actorId: actor.id,
          payload: { cause: "TOURNAMENT", reason },
        });
      }
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { isPaused: true, pausedAt: ctx.now },
      });
      ctx.tournament.isPaused = true;
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.pause",
        entityType: "Tournament",
        entityId: tournamentId,
        before: { isPaused: false },
        after: { isPaused: true, pausedAt: ctx.now, pausedMatches: running.map((m) => m.code) },
        reason,
      });
      return { isPaused: true, pausedMatches: running.map((m) => m.code) };
    },
    txOpts(opts),
  );
}

export async function resumeTournament(actor: Actor, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      const t = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { isPaused: true, pausedAt: true },
      });
      if (!t.isPaused) fail("INVALID_STATE", "Das Turnier ist nicht pausiert.");
      const paused = t.pausedAt
        ? await tx.match.findMany({
            where: { tournamentId, status: "IN_PROGRESS", pausedAt: t.pausedAt },
            orderBy: { orderIndex: "asc" },
            select: { id: true, code: true, version: true, pausedAt: true },
          })
        : [];
      await lockMatches(
        tx,
        paused.map((m) => m.id),
      );
      for (const m of paused) {
        const ms = Math.max(0, ctx.now.getTime() - m.pausedAt!.getTime());
        await updateMatchVersioned(tx, m.id, m.version, {
          pausedAt: null,
          pausedDurationMs: { increment: ms },
        });
        await writeMatchEvent(tx, {
          tournamentId,
          matchId: m.id,
          type: "RESUMED",
          actorId: actor.id,
          payload: { cause: "TOURNAMENT", pausedMs: ms },
        });
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { isPaused: false, pausedAt: null } });
      ctx.tournament.isPaused = false;
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tournament.resume",
        entityType: "Tournament",
        entityId: tournamentId,
        before: { isPaused: true, pausedAt: t.pausedAt },
        after: { isPaused: false, resumedMatches: paused.map((m) => m.code) },
      });
      return { isPaused: false, resumedMatches: paused.map((m) => m.code) };
    },
    txOpts(opts),
  );
}
