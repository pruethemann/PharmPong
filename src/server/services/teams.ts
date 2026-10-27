// Team formation: create / join / leave, invitations, readiness, profile edits
// and audited admin repair tools. Every mutation runs inside withTournamentTx,
// which serializes writers per tournament; the partial unique indexes on
// TeamMember are the final guard against double membership and overfull teams.
import { db, type Db, type Tx } from "@/server/db";
import { fail } from "@/server/domain/errors";
import { assertRole, isAdmin } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { hit, isLocked, RULES, type ThrottleRule } from "@/server/auth/throttle";
import { inviteCode as newInviteCode, normalizeInviteCode } from "@/server/auth/tokens";
import type { TeamStatus, TournamentStatus } from "@/generated/prisma/enums";
import {
  cleanTeamName,
  MOTTO_MAX,
  normalizeTeamName,
  TEAM_NAME_MAX,
  TEAM_NAME_MIN,
} from "@/lib/validation/team";
import { writeAudit } from "./audit";
import { getCurrentTournamentId, withTournamentTx, type TxContext } from "./tx";

export const TEAM_SIZE = 2;

export type TeamOpts = { tournamentId?: string };

// ─── Helpers ───────────────────────────────────────────────────────────────

export function teamLogoUrl(team: {
  id: string;
  logoKey: string | null;
  logoVersion: number;
}): string | null {
  return team.logoKey ? `/api/logos/${team.id}?v=${team.logoVersion}` : null;
}

/**
 * Domain rule (not only a form rule): cleaned name has 2–32 characters.
 * Returns the cleaned display form.
 */
export function assertTeamName(raw: string): string {
  const name = cleanTeamName(typeof raw === "string" ? raw : "");
  if (name.length < TEAM_NAME_MIN || name.length > TEAM_NAME_MAX) {
    fail(
      "VALIDATION",
      `Der Teamname muss ${TEAM_NAME_MIN}–${TEAM_NAME_MAX} Zeichen lang sein.`,
      { field: "name" },
      { key: "teamNameLength", values: { min: TEAM_NAME_MIN, max: TEAM_NAME_MAX } },
    );
  }
  return name;
}

/** Motto: trimmed, whitespace collapsed, empty → null, at most 80 characters. */
export function assertMotto(raw: string | null | undefined): string | null {
  const motto = (raw ?? "").trim().replace(/\s+/g, " ");
  if (motto.length > MOTTO_MAX) {
    fail(
      "VALIDATION",
      `Das Motto darf höchstens ${MOTTO_MAX} Zeichen lang sein.`,
      { field: "motto" },
      { key: "mottoTooLong", values: { max: MOTTO_MAX } },
    );
  }
  return motto.length ? motto : null;
}

async function resolveTournamentId(opts?: TeamOpts): Promise<string> {
  const id = opts?.tournamentId ?? (await getCurrentTournamentId());
  if (!id) fail("NOT_FOUND", "Kein Turnier gefunden.", undefined, { key: "noTournament" });
  return id;
}

const AFTER_LOCK: readonly TournamentStatus[] = [
  "REGISTRATION_LOCKED",
  "GROUP_STAGE",
  "KNOCKOUT_STAGE",
  "COMPLETED",
  "CANCELLED",
];
const BEFORE_GROUP_STAGE: readonly TournamentStatus[] = ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_LOCKED"];
const FINISHED: readonly TournamentStatus[] = ["COMPLETED", "CANCELLED"];

/** Players may create/join/leave only while registration is open. */
function assertRegistrationOpen(status: TournamentStatus): void {
  if (status === "REGISTRATION_OPEN") return;
  if (status === "DRAFT")
    fail("INVALID_STATE", "Die Anmeldung ist noch nicht geöffnet.", undefined, {
      key: "registrationNotOpen",
    });
  fail("ROSTER_LOCKED");
}

/** Name changes by members are possible until the roster lock. */
export function canEditName(status: TournamentStatus): boolean {
  return status === "DRAFT" || status === "REGISTRATION_OPEN";
}

/** Motto and logo stay editable until the tournament ends. */
export function canEditProfile(status: TournamentStatus): boolean {
  return !FINISHED.includes(status);
}

function assertNotFinished(status: TournamentStatus): void {
  if (FINISHED.includes(status))
    fail("INVALID_STATE", "Das Turnier ist bereits beendet.", undefined, { key: "tournamentFinished" });
}

type LockedTeam = {
  id: string;
  tournamentId: string;
  name: string;
  nameNormalized: string;
  motto: string | null;
  inviteCode: string;
  status: TeamStatus;
  version: number;
  logoKey: string | null;
  logoVersion: number;
};

async function lockTeam(tx: Tx, teamId: string, tournamentId: string): Promise<LockedTeam> {
  const rows = await tx.$queryRaw<LockedTeam[]>`
    SELECT id, "tournamentId", name, "nameNormalized", motto, "inviteCode", status::text AS status,
           version, "logoKey", "logoVersion"
    FROM "Team" WHERE id = ${teamId} FOR UPDATE`;
  const team = rows[0];
  if (!team || team.tournamentId !== tournamentId)
    fail("NOT_FOUND", "Team nicht gefunden.", undefined, { key: "teamNotFound" });
  return team;
}

async function activeMembers(tx: Tx, teamId: string) {
  return tx.teamMember.findMany({
    where: { teamId, leftAt: null },
    orderBy: { slot: "asc" },
    select: { id: true, userId: true, slot: true, isReady: true },
  });
}

async function activeMembershipOf(tx: Tx, tournamentId: string, userId: string) {
  return tx.teamMember.findFirst({
    where: { tournamentId, userId, leftAt: null },
    select: { id: true, teamId: true, slot: true, isReady: true },
  });
}

async function assertNameFree(tx: Tx, tournamentId: string, name: string, exceptTeamId?: string) {
  const clash = await tx.team.findFirst({
    where: {
      tournamentId,
      nameNormalized: normalizeTeamName(name),
      ...(exceptTeamId ? { id: { not: exceptTeamId } } : {}),
    },
    select: { id: true },
  });
  if (clash) fail("NAME_TAKEN");
}

async function uniqueInviteCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newInviteCode();
    const exists = await tx.team.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  fail("INTERNAL", "Could not generate a unique invite code");
}

function freeSlot(members: { slot: number }[]): number {
  const used = new Set(members.map((m) => m.slot));
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  fail("TEAM_FULL");
}

async function assertUserCanJoin(tx: Tx, tournamentId: string, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!user || !user.isActive)
    fail("NOT_FOUND", "Benutzer:in nicht gefunden.", undefined, { key: "userNotFound" });
  const existing = await activeMembershipOf(tx, tournamentId, userId);
  if (existing) fail("ALREADY_IN_TEAM", undefined, { userId });
}

/** Mark a team dissolved and free its name for reuse (unique index on nameNormalized). */
async function dissolve(tx: Tx, team: LockedTeam, now: Date) {
  await tx.teamMember.updateMany({
    where: { teamId: team.id, leftAt: null },
    data: { leftAt: now, isReady: false },
  });
  await tx.team.update({
    where: { id: team.id },
    data: {
      status: "DISSOLVED",
      nameNormalized: `${team.nameNormalized}#dissolved-${team.id}`,
      version: { increment: 1 },
    },
  });
}

async function bumpVersion(tx: Tx, teamId: string) {
  await tx.team.update({ where: { id: teamId }, data: { version: { increment: 1 } } });
}

async function teamTournamentId(teamId: string): Promise<string> {
  const t = await db.team.findUnique({ where: { id: teamId }, select: { tournamentId: true } });
  if (!t) fail("NOT_FOUND", "Team nicht gefunden.", undefined, { key: "teamNotFound" });
  return t.tournamentId;
}

// ─── Player operations ─────────────────────────────────────────────────────

export async function createTeam(
  actor: Actor,
  input: { name: string; motto?: string | null },
  opts?: TeamOpts,
): Promise<{ teamId: string; inviteCode: string }> {
  assertRole(actor, "PLAYER");
  const name = assertTeamName(input.name);
  const motto = assertMotto(input.motto);
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    assertRegistrationOpen(ctx.tournament.status);
    if (await activeMembershipOf(tx, tournamentId, actor.id)) fail("ALREADY_IN_TEAM");
    await assertNameFree(tx, tournamentId, name);
    const code = await uniqueInviteCode(tx);
    const team = await tx.team.create({
      data: {
        tournamentId,
        name,
        nameNormalized: normalizeTeamName(name),
        motto,
        inviteCode: code,
        createdById: actor.id,
        members: { create: { tournamentId, userId: actor.id, slot: 1 } },
      },
    });
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: "team.create",
      entityType: "Team",
      entityId: team.id,
      after: { name, motto: team.motto },
    });
    return { teamId: team.id, inviteCode: code };
  });
}

/**
 * Redeem an invitation code. Failed attempts with an unknown code are throttled
 * per user (`join:user:<id>`), so codes cannot be brute-forced.
 *
 * The throttle check and the failure count both happen while holding the
 * tournament row lock, and a miss is committed (not rolled back) before the
 * lock is released. Concurrent attempts are therefore serialized against the
 * throttle state: a burst cannot run more than RULES.join.limit lookups.
 */
export async function joinTeam(
  actor: Actor,
  rawCode: string,
  opts?: TeamOpts,
): Promise<{ teamId: string; slot: number }> {
  assertRole(actor, "PLAYER");
  const throttleKey = `join:user:${actor.id}`;
  // Cheap early exit; the authoritative check is repeated under the lock below.
  if (await isLocked(throttleKey)) fail("RATE_LIMITED");
  const tournamentId = await resolveTournamentId(opts);
  const code = normalizeInviteCode(rawCode);
  const result = await withTournamentTx(tournamentId, async (tx, ctx) => {
    assertRegistrationOpen(ctx.tournament.status);
    // throttle.ts types its client as Db; it only uses authThrottle + $queryRaw,
    // which a transaction client provides as well.
    const throttleDb = tx as unknown as Db;
    if (await isLocked(throttleKey, throttleDb)) fail("RATE_LIMITED");
    const rows = code
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Team"
          WHERE "inviteCode" = ${code} AND "tournamentId" = ${tournamentId} AND status = 'ACTIVE'
          FOR UPDATE`
      : [];
    const teamId = rows[0]?.id;
    if (!teamId) {
      // Count the miss inside this transaction and commit it (no domain change,
      // so no revision bump); the caller turns it into INVALID_INVITE.
      const h = await hit(throttleKey, RULES.join, throttleDb);
      ctx.dirty = false;
      return { ok: false as const, locked: h.locked };
    }
    if (await activeMembershipOf(tx, tournamentId, actor.id)) fail("ALREADY_IN_TEAM");
    const members = await activeMembers(tx, teamId);
    if (members.length >= TEAM_SIZE) fail("TEAM_FULL");
    const slot = freeSlot(members);
    await tx.teamMember.create({ data: { tournamentId, teamId, userId: actor.id, slot } });
    await bumpVersion(tx, teamId);
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: "team.join",
      entityType: "Team",
      entityId: teamId,
      after: { userId: actor.id, slot },
    });
    return { ok: true as const, teamId, slot };
  });
  if (!result.ok) fail(result.locked ? "RATE_LIMITED" : "INVALID_INVITE");
  return { teamId: result.teamId, slot: result.slot };
}

/** Leave the current team (before roster lock). The last member leaving dissolves the team. */
export async function leaveTeam(actor: Actor, opts?: TeamOpts): Promise<{ dissolved: boolean }> {
  assertRole(actor, "PLAYER");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    assertRegistrationOpen(ctx.tournament.status);
    const membership = await activeMembershipOf(tx, tournamentId, actor.id);
    if (!membership) fail("NOT_IN_TEAM");
    const team = await lockTeam(tx, membership.teamId, tournamentId);
    await tx.teamMember.update({
      where: { id: membership.id },
      data: { leftAt: ctx.now, isReady: false },
    });
    const remaining = await activeMembers(tx, team.id);
    const dissolved = remaining.length === 0;
    if (dissolved) await dissolve(tx, team, ctx.now);
    else await bumpVersion(tx, team.id);
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: dissolved ? "team.leave_dissolve" : "team.leave",
      entityType: "Team",
      entityId: team.id,
      before: { userId: actor.id, slot: membership.slot },
    });
    return { dissolved };
  });
}

/** Any member may rotate the code; the old code stops working immediately. */
export async function rotateInviteCode(
  actor: Actor,
  opts?: TeamOpts,
): Promise<{ teamId: string; inviteCode: string }> {
  assertRole(actor, "PLAYER");
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    assertRegistrationOpen(ctx.tournament.status);
    const membership = await activeMembershipOf(tx, tournamentId, actor.id);
    if (!membership) fail("NOT_IN_TEAM");
    const team = await lockTeam(tx, membership.teamId, tournamentId);
    const code = await uniqueInviteCode(tx);
    await tx.team.update({ where: { id: team.id }, data: { inviteCode: code, version: { increment: 1 } } });
    // The code itself is a secret: never write it to the audit log.
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: "team.rotate_invite",
      entityType: "Team",
      entityId: team.id,
    });
    return { teamId: team.id, inviteCode: code };
  });
}

/** Members edit name (until roster lock) and motto (until the end). Optimistic via expectedVersion. */
export async function updateTeam(
  actor: Actor,
  input: { teamId: string; expectedVersion: number; name?: string; motto?: string | null },
): Promise<{ version: number }> {
  assertRole(actor, "PLAYER");
  const tournamentId = await teamTournamentId(input.teamId);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    const team = await lockTeam(tx, input.teamId, tournamentId);
    const membership = await activeMembershipOf(tx, tournamentId, actor.id);
    if (membership?.teamId !== team.id) fail("FORBIDDEN");
    if (team.status !== "ACTIVE")
      fail("INVALID_STATE", "Dieses Team ist aufgelöst.", undefined, { key: "teamDissolved" });
    if (team.version !== input.expectedVersion) fail("STALE_VERSION", undefined, { version: team.version });

    const data: { name?: string; nameNormalized?: string; motto?: string | null } = {};
    if (input.name !== undefined) {
      const name = assertTeamName(input.name);
      if (name !== team.name) {
        if (!canEditName(ctx.tournament.status)) fail("ROSTER_LOCKED");
        await assertNameFree(tx, tournamentId, name, team.id);
        data.name = name;
        data.nameNormalized = normalizeTeamName(name);
      }
    }
    const motto = input.motto === undefined ? undefined : assertMotto(input.motto);
    if (motto !== undefined && motto !== team.motto) {
      assertNotFinished(ctx.tournament.status);
      data.motto = motto;
    }
    if (Object.keys(data).length === 0) {
      ctx.dirty = false;
      return { version: team.version };
    }
    const res = await tx.team.updateMany({
      where: { id: team.id, version: input.expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) fail("STALE_VERSION");
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: "team.update",
      entityType: "Team",
      entityId: team.id,
      before: { name: team.name, motto: team.motto },
      after: { name: data.name ?? team.name, motto: "motto" in data ? data.motto : team.motto },
    });
    return { version: team.version + 1 };
  });
}

/** "Wir sind bereit": informational check-in per member, visible to admins. */
export async function setReady(actor: Actor, ready: boolean, opts?: TeamOpts): Promise<void> {
  assertRole(actor, "PLAYER");
  const tournamentId = await resolveTournamentId(opts);
  await withTournamentTx(tournamentId, async (tx, ctx) => {
    if (!BEFORE_GROUP_STAGE.includes(ctx.tournament.status) || ctx.tournament.status === "DRAFT") {
      fail("INVALID_STATE", "Der Check-in ist nur während der Anmeldung möglich.", undefined, {
        key: "checkInOnlyDuringRegistration",
      });
    }
    const membership = await activeMembershipOf(tx, tournamentId, actor.id);
    if (!membership) fail("NOT_IN_TEAM");
    if (membership.isReady === ready) {
      ctx.dirty = false;
      return;
    }
    await tx.teamMember.update({ where: { id: membership.id }, data: { isReady: ready } });
    await bumpVersion(tx, membership.teamId);
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: ready ? "team.ready" : "team.unready",
      entityType: "Team",
      entityId: membership.teamId,
    });
  });
}

// ─── Admin repair ──────────────────────────────────────────────────────────

/** Run an audited admin repair on an existing team (any status except COMPLETED/CANCELLED). */
async function adminTeamTx<T>(
  actor: Actor,
  teamId: string,
  fn: (tx: Tx, ctx: TxContext, team: LockedTeam) => Promise<T>,
): Promise<T> {
  assertRole(actor, "ADMIN");
  const tournamentId = await teamTournamentId(teamId);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    assertNotFinished(ctx.tournament.status);
    const team = await lockTeam(tx, teamId, tournamentId);
    return fn(tx, ctx, team);
  });
}

function assertActiveTeam(team: LockedTeam) {
  if (team.status !== "ACTIVE")
    fail("INVALID_STATE", "Dieses Team ist aufgelöst.", undefined, { key: "teamDissolved" });
}

export async function adminRenameTeam(
  actor: Actor,
  input: { teamId: string; name: string; reason: string },
): Promise<void> {
  const name = assertTeamName(input.name);
  await adminTeamTx(actor, input.teamId, async (tx, ctx, team) => {
    assertActiveTeam(team);
    await assertNameFree(tx, team.tournamentId, name, team.id);
    await tx.team.update({
      where: { id: team.id },
      data: { name, nameNormalized: normalizeTeamName(name), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.rename",
      entityType: "Team",
      entityId: team.id,
      before: { name: team.name },
      after: { name },
      reason: input.reason,
    });
  });
}

export async function adminSetMotto(
  actor: Actor,
  input: { teamId: string; motto: string | null; reason: string },
): Promise<void> {
  const motto = assertMotto(input.motto);
  await adminTeamTx(actor, input.teamId, async (tx, _ctx, team) => {
    assertActiveTeam(team);
    await tx.team.update({
      where: { id: team.id },
      data: { motto, version: { increment: 1 } },
    });
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.motto",
      entityType: "Team",
      entityId: team.id,
      before: { motto: team.motto },
      after: { motto },
      reason: input.reason,
    });
  });
}

/**
 * Remove a member. Before the group stage an emptied team is dissolved (name freed);
 * afterwards it stays ACTIVE so fixtures and history keep their team.
 */
export async function adminRemoveMember(
  actor: Actor,
  input: { teamId: string; userId: string; reason: string },
): Promise<{ dissolved: boolean }> {
  return adminTeamTx(actor, input.teamId, async (tx, ctx, team) => {
    assertActiveTeam(team);
    const members = await activeMembers(tx, team.id);
    const m = members.find((x) => x.userId === input.userId);
    if (!m) fail("NOT_IN_TEAM", "Diese Person ist nicht im Team.", undefined, { key: "personNotInTeam" });
    await tx.teamMember.update({ where: { id: m.id }, data: { leftAt: ctx.now, isReady: false } });
    const dissolved = members.length === 1 && BEFORE_GROUP_STAGE.includes(ctx.tournament.status);
    if (dissolved) await dissolve(tx, team, ctx.now);
    else await bumpVersion(tx, team.id);
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.remove_member",
      entityType: "Team",
      entityId: team.id,
      before: { userId: m.userId, slot: m.slot },
      after: { dissolved },
      reason: input.reason,
    });
    return { dissolved };
  });
}

export async function adminAddMember(
  actor: Actor,
  input: { teamId: string; userId: string; reason: string },
): Promise<{ slot: number }> {
  return adminTeamTx(actor, input.teamId, async (tx, _ctx, team) => {
    assertActiveTeam(team);
    await assertUserCanJoin(tx, team.tournamentId, input.userId);
    const members = await activeMembers(tx, team.id);
    if (members.length >= TEAM_SIZE) fail("TEAM_FULL");
    const slot = freeSlot(members);
    await tx.teamMember.create({
      data: { tournamentId: team.tournamentId, teamId: team.id, userId: input.userId, slot },
    });
    await bumpVersion(tx, team.id);
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.add_member",
      entityType: "Team",
      entityId: team.id,
      after: { userId: input.userId, slot },
      reason: input.reason,
    });
    return { slot };
  });
}

/** Replace an absent player. Works after roster lock and during play. */
export async function adminReplaceMember(
  actor: Actor,
  input: { teamId: string; oldUserId: string; newUserId: string; reason: string },
): Promise<void> {
  if (input.oldUserId === input.newUserId)
    fail("VALIDATION", "Alte und neue Person sind identisch.", undefined, { key: "samePerson" });
  await adminTeamTx(actor, input.teamId, async (tx, ctx, team) => {
    assertActiveTeam(team);
    const members = await activeMembers(tx, team.id);
    const old = members.find((x) => x.userId === input.oldUserId);
    if (!old) fail("NOT_IN_TEAM", "Diese Person ist nicht im Team.", undefined, { key: "personNotInTeam" });
    await assertUserCanJoin(tx, team.tournamentId, input.newUserId);
    await tx.teamMember.update({ where: { id: old.id }, data: { leftAt: ctx.now, isReady: false } });
    await tx.teamMember.create({
      data: { tournamentId: team.tournamentId, teamId: team.id, userId: input.newUserId, slot: old.slot },
    });
    await bumpVersion(tx, team.id);
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.replace_member",
      entityType: "Team",
      entityId: team.id,
      before: { userId: input.oldUserId, slot: old.slot },
      after: { userId: input.newUserId, slot: old.slot },
      reason: input.reason,
    });
  });
}

/** Dissolve a team. Only before the group stage and only if it has not been drawn into a group. */
export async function adminDissolveTeam(
  actor: Actor,
  input: { teamId: string; reason: string },
): Promise<void> {
  await adminTeamTx(actor, input.teamId, async (tx, ctx, team) => {
    assertActiveTeam(team);
    if (!BEFORE_GROUP_STAGE.includes(ctx.tournament.status)) {
      fail(
        "INVALID_STATE",
        "Teams können nach Beginn der Gruppenphase nicht mehr aufgelöst werden.",
        undefined,
        { key: "cannotDissolveAfterGroups" },
      );
    }
    const drawn = await tx.groupAssignment.findUnique({
      where: { teamId: team.id },
      select: { teamId: true },
    });
    if (drawn)
      fail("INVALID_STATE", "Das Team ist bereits einer Gruppe zugelost.", undefined, {
        key: "alreadyDrawn",
      });
    const members = await activeMembers(tx, team.id);
    await dissolve(tx, team, ctx.now);
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: "admin.team.dissolve",
      entityType: "Team",
      entityId: team.id,
      before: { name: team.name, memberUserIds: members.map((m) => m.userId) },
      reason: input.reason,
    });
  });
}

/** Create a team on behalf of players (registration problems). */
export async function adminCreateTeam(
  actor: Actor,
  input: { name: string; motto?: string | null; memberUserIds: string[]; reason: string },
  opts?: TeamOpts,
): Promise<{ teamId: string; inviteCode: string }> {
  assertRole(actor, "ADMIN");
  const ids = [...new Set(input.memberUserIds)];
  if (ids.length !== input.memberUserIds.length || ids.length > TEAM_SIZE) {
    fail("VALIDATION", "Ungültige Mitgliederliste.", undefined, { key: "invalidMemberList" });
  }
  const name = assertTeamName(input.name);
  const motto = assertMotto(input.motto);
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(tournamentId, async (tx, ctx) => {
    assertNotFinished(ctx.tournament.status);
    await assertNameFree(tx, tournamentId, name);
    for (const userId of ids) await assertUserCanJoin(tx, tournamentId, userId);
    const code = await uniqueInviteCode(tx);
    const team = await tx.team.create({
      data: {
        tournamentId,
        name,
        nameNormalized: normalizeTeamName(name),
        motto,
        inviteCode: code,
        createdById: actor.id,
        members: { create: ids.map((userId, i) => ({ tournamentId, userId, slot: i + 1 })) },
      },
    });
    await writeAudit(tx, {
      tournamentId,
      actorId: actor.id,
      action: "admin.team.create",
      entityType: "Team",
      entityId: team.id,
      after: { name, motto: team.motto, memberUserIds: ids },
      reason: input.reason,
    });
    return { teamId: team.id, inviteCode: code };
  });
}

// ─── Read models ───────────────────────────────────────────────────────────

export type MyTeamMember = {
  userId: string;
  displayName: string;
  slot: number;
  isReady: boolean;
  joinedAt: Date;
};

export type MyTeam = {
  id: string;
  tournamentId: string;
  name: string;
  motto: string | null;
  inviteCode: string;
  version: number;
  logoUrl: string | null;
  createdAt: Date;
  members: MyTeamMember[];
  complete: boolean;
  eligible: boolean;
};

export async function getTournamentStatus(
  opts?: TeamOpts,
): Promise<{ id: string; status: TournamentStatus } | null> {
  const id = opts?.tournamentId ?? (await getCurrentTournamentId());
  if (!id) return null;
  return db.tournament.findUnique({ where: { id }, select: { id: true, status: true } });
}

/** Full profile of the user's active team (members only see their own team's code). */
export async function getMyTeam(userId: string, opts?: TeamOpts): Promise<MyTeam | null> {
  const tournamentId = opts?.tournamentId ?? (await getCurrentTournamentId());
  if (!tournamentId) return null;
  const membership = await db.teamMember.findFirst({
    where: { tournamentId, userId, leftAt: null },
    select: { teamId: true },
  });
  if (!membership) return null;
  const team = await db.team.findUnique({
    where: { id: membership.teamId },
    include: {
      members: {
        where: { leftAt: null },
        orderBy: { slot: "asc" },
        include: { user: { select: { displayName: true } } },
      },
    },
  });
  if (!team) return null;
  const complete = team.members.length === TEAM_SIZE;
  return {
    id: team.id,
    tournamentId: team.tournamentId,
    name: team.name,
    motto: team.motto,
    inviteCode: team.inviteCode,
    version: team.version,
    logoUrl: teamLogoUrl(team),
    createdAt: team.createdAt,
    members: team.members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      slot: m.slot,
      isReady: m.isReady,
      joinedAt: m.joinedAt,
    })),
    complete,
    eligible: team.status === "ACTIVE" && complete,
  };
}

export type TeamPreview = {
  name: string;
  motto: string | null;
  logoUrl: string | null;
  memberCount: number;
  registrationOpen: boolean;
};

/** Public preview for /join/[code]. Deliberately minimal: no ids, member names or emails. */
export async function getTeamPreviewByCode(rawCode: string): Promise<TeamPreview | null> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  const team = await db.team.findUnique({
    where: { inviteCode: code },
    select: {
      id: true,
      name: true,
      motto: true,
      status: true,
      logoKey: true,
      logoVersion: true,
      tournament: { select: { status: true } },
      _count: { select: { members: { where: { leftAt: null } } } },
    },
  });
  if (!team || team.status !== "ACTIVE") return null;
  return {
    name: team.name,
    motto: team.motto,
    logoUrl: teamLogoUrl(team),
    memberCount: team._count.members,
    registrationOpen: team.tournament.status === "REGISTRATION_OPEN",
  };
}

/** Misses per client IP on the public join page (venue NAT: generous, misses only). */
export const JOIN_PREVIEW_RULE: ThrottleRule = { limit: 30, windowSec: 15 * 60, lockSec: 15 * 60 };

export type TeamPreviewLookup =
  { status: "ok"; preview: TeamPreview } | { status: "not_found" } | { status: "rate_limited" };

/**
 * Throttled preview lookup for the unauthenticated /join/[code] page, so the page
 * cannot be used as an unlimited invite-code oracle. Each lookup first reserves
 * an attempt atomically (`joinpreview:ip:<ip>`), so parallel bursts are bounded
 * too; a hit is refunded, so only misses count toward the limit.
 */
export async function lookupTeamPreview(rawCode: string, ip: string): Promise<TeamPreviewLookup> {
  const key = `joinpreview:ip:${ip}`;
  if (await isLocked(key)) return { status: "rate_limited" };
  const reserved = await hit(key, JOIN_PREVIEW_RULE);
  if (reserved.locked) return { status: "rate_limited" };
  const preview = await getTeamPreviewByCode(rawCode);
  if (!preview) return { status: "not_found" };
  await db.$executeRaw`
    UPDATE "AuthThrottle" SET count = GREATEST(count - 1, 0)
    WHERE key = ${key} AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())`;
  return { status: "ok", preview };
}

export type PublicTeam = {
  id: string;
  name: string;
  motto: string | null;
  logoUrl: string | null;
  memberDisplayNames: string[];
  complete: boolean;
};

/** Public team list: never emails or invite codes. */
export async function listTeamsPublic(tournamentId: string): Promise<PublicTeam[]> {
  const teams = await db.team.findMany({
    where: { tournamentId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      motto: true,
      logoKey: true,
      logoVersion: true,
      members: {
        where: { leftAt: null },
        orderBy: { slot: "asc" },
        select: { user: { select: { displayName: true } } },
      },
    },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    motto: t.motto,
    logoUrl: teamLogoUrl(t),
    memberDisplayNames: t.members.map((m) => m.user.displayName),
    complete: t.members.length === TEAM_SIZE,
  }));
}

export type AdminTeam = PublicTeam & {
  status: TeamStatus;
  inviteCode: string;
  version: number;
  createdAt: Date;
  eligible: boolean;
  allReady: boolean;
  members: { userId: string; displayName: string; email: string; slot: number; isReady: boolean }[];
};

export async function listTeamsAdmin(actor: Actor, tournamentId: string): Promise<AdminTeam[]> {
  assertRole(actor, "ADMIN");
  const teams = await db.team.findMany({
    where: { tournamentId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      members: {
        where: { leftAt: null },
        orderBy: { slot: "asc" },
        include: { user: { select: { displayName: true, email: true } } },
      },
    },
  });
  return teams.map((t) => {
    const complete = t.members.length === TEAM_SIZE;
    return {
      id: t.id,
      name: t.name,
      motto: t.motto,
      logoUrl: teamLogoUrl(t),
      memberDisplayNames: t.members.map((m) => m.user.displayName),
      complete,
      status: t.status,
      inviteCode: t.inviteCode,
      version: t.version,
      createdAt: t.createdAt,
      eligible: t.status === "ACTIVE" && complete,
      allReady: complete && t.members.every((m) => m.isReady),
      members: t.members.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        email: m.user.email,
        slot: m.slot,
        isReady: m.isReady,
      })),
    };
  });
}

/** True if the actor is an active member of the team, or an admin. */
export async function canManageTeam(actor: Actor, teamId: string, client: Tx | typeof db = db) {
  if (isAdmin(actor)) return true;
  const m = await client.teamMember.findFirst({
    where: { teamId, userId: actor.id, leftAt: null },
    select: { id: true },
  });
  return !!m;
}

/** Roster is locked from REGISTRATION_LOCKED onwards. */
export function isRosterLocked(status: TournamentStatus): boolean {
  return AFTER_LOCK.includes(status);
}
