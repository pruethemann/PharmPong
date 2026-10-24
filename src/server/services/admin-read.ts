// Read models for the admin interface: audit log, match event timeline,
// recorded ranking shootouts, open issues. ADMIN only (defense in depth on top
// of the page guard). Never returns password hashes, tokens or session ids.
import { db, type Db } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import type { Prisma } from "@/generated/prisma/client";
import { redactJson } from "@/lib/admin-redact";

export const AUDIT_PAGE_SIZE = 50;

async function displayNames(client: Db, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const users = await client.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

// ─── Audit log ─────────────────────────────────────────────────────────────

export type AuditScope = "current" | "all";

export type AuditQuery = {
  page?: number;
  actionPrefix?: string | null;
  entityType?: string | null;
  /** "current": the given tournament plus global entries (no tournament); "all": everything. */
  scope?: AuditScope;
  tournamentId?: string | null;
};

export type AuditRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Human readable entity (match code, team name, user name, table name), if resolvable. */
  entityLabel: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
};

export type AuditPage = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  entityTypes: string[];
};

function auditWhere(q: AuditQuery): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  const prefix = q.actionPrefix?.trim();
  if (prefix) and.push({ action: { startsWith: prefix } });
  const type = q.entityType?.trim();
  if (type) and.push({ entityType: type });
  if ((q.scope ?? "current") === "current" && q.tournamentId) {
    and.push({ OR: [{ tournamentId: q.tournamentId }, { tournamentId: null }] });
  }
  return and.length ? { AND: and } : {};
}

async function entityLabels(
  client: Db,
  rows: { entityType: string; entityId: string }[],
): Promise<Map<string, string>> {
  const ids = (t: string) => [...new Set(rows.filter((r) => r.entityType === t).map((r) => r.entityId))];
  const [matches, teams, users, tables, tournaments] = await Promise.all([
    ids("Match").length
      ? client.match.findMany({ where: { id: { in: ids("Match") } }, select: { id: true, code: true } })
      : [],
    ids("Team").length
      ? client.team.findMany({ where: { id: { in: ids("Team") } }, select: { id: true, name: true } })
      : [],
    ids("User").length
      ? client.user.findMany({
          where: { id: { in: ids("User") } },
          select: { id: true, displayName: true },
        })
      : [],
    ids("GameTable").length
      ? client.gameTable.findMany({
          where: { id: { in: ids("GameTable") } },
          select: { id: true, name: true, number: true },
        })
      : [],
    ids("Tournament").length
      ? client.tournament.findMany({
          where: { id: { in: ids("Tournament") } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const map = new Map<string, string>();
  for (const m of matches) map.set(`Match:${m.id}`, m.code);
  for (const t of teams) map.set(`Team:${t.id}`, t.name);
  for (const u of users) map.set(`User:${u.id}`, u.displayName);
  for (const t of tournaments) map.set(`Tournament:${t.id}`, t.name);
  for (const t of tables) map.set(`GameTable:${t.id}`, `Tisch ${t.number} (${t.name})`);
  return map;
}

/** Newest first, 50 per page. */
export async function listAuditLog(actor: Actor, q: AuditQuery = {}, client: Db = db): Promise<AuditPage> {
  assertRole(actor, "ADMIN");
  const where = auditWhere(q);
  const [total, typeRows] = await Promise.all([
    client.auditLog.count({ where }),
    client.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1) || 1), pageCount);
  const rows = await client.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });
  const [names, labels] = await Promise.all([
    displayNames(
      client,
      rows.map((r) => r.actorId),
    ),
    entityLabels(client, rows),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt.toISOString(),
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      entityLabel: labels.get(`${r.entityType}:${r.entityId}`) ?? null,
      reason: r.reason,
      before: redactJson(r.before ?? null),
      after: redactJson(r.after ?? null),
    })),
    total,
    page,
    pageCount,
    pageSize: AUDIT_PAGE_SIZE,
    entityTypes: typeRows.map((t) => t.entityType).sort(),
  };
}

// ─── Match timeline ────────────────────────────────────────────────────────

export type MatchEventRow = {
  id: string;
  type: string;
  createdAt: string;
  actorName: string | null;
  payload: unknown;
};

/** All events of a match, oldest first, including ISSUE events and actor names (admin view). */
export async function listMatchEvents(
  actor: Actor,
  matchId: string,
  client: Db = db,
): Promise<MatchEventRow[]> {
  assertRole(actor, "ADMIN");
  const rows = await client.matchEvent.findMany({
    where: { matchId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  const names = await displayNames(
    client,
    rows.map((r) => r.actorId),
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
    payload: redactJson(r.payload ?? null),
  }));
}

// ─── Ranking shootouts ─────────────────────────────────────────────────────

export type TiebreakRow = {
  id: string;
  group: string;
  orderedTeams: { id: string; name: string }[];
  note: string | null;
  createdAt: string;
  recordedByName: string | null;
  voidedAt: string | null;
};

export async function listTiebreaks(
  actor: Actor,
  tournamentId: string,
  client: Db = db,
): Promise<TiebreakRow[]> {
  assertRole(actor, "ADMIN");
  const rows = await client.groupTiebreak.findMany({
    where: { group: { tournamentId } },
    orderBy: { createdAt: "desc" },
    include: { group: { select: { name: true } } },
  });
  const teamIds = [...new Set(rows.flatMap((r) => r.orderedTeamIds))];
  const [teams, names] = await Promise.all([
    teamIds.length
      ? client.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [],
    displayNames(
      client,
      rows.map((r) => r.recordedById),
    ),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    id: r.id,
    group: r.group.name,
    orderedTeams: r.orderedTeamIds.map((id) => ({ id, name: teamName.get(id) ?? "?" })),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    recordedByName: names.get(r.recordedById) ?? null,
    voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
  }));
}

// ─── Open issues ───────────────────────────────────────────────────────────

export type OpenIssueRow = {
  matchId: string;
  code: string;
  text: string;
  reportedAt: string;
  reportedByName: string | null;
};

/** Matches whose latest ISSUE_REPORTED is newer than their latest ISSUE_RESOLVED. */
export async function listOpenIssues(
  actor: Actor,
  tournamentId: string,
  client: Db = db,
): Promise<OpenIssueRow[]> {
  assertRole(actor, "ADMIN");
  const events = await client.matchEvent.findMany({
    where: { tournamentId, type: { in: ["ISSUE_REPORTED", "ISSUE_RESOLVED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { matchId: true, type: true, payload: true, createdAt: true, actorId: true },
  });
  const open = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (e.type === "ISSUE_REPORTED") open.set(e.matchId, e);
    else open.delete(e.matchId);
  }
  if (open.size === 0) return [];
  const [matches, names] = await Promise.all([
    client.match.findMany({ where: { id: { in: [...open.keys()] } }, select: { id: true, code: true } }),
    displayNames(
      client,
      [...open.values()].map((e) => e.actorId),
    ),
  ]);
  const code = new Map(matches.map((m) => [m.id, m.code]));
  return [...open.values()].map((e) => {
    const p = e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? e.payload : {};
    const text =
      typeof (p as Record<string, unknown>).text === "string"
        ? String((p as Record<string, unknown>).text)
        : "";
    return {
      matchId: e.matchId,
      code: code.get(e.matchId) ?? "?",
      text,
      reportedAt: e.createdAt.toISOString(),
      reportedByName: e.actorId ? (names.get(e.actorId) ?? null) : null,
    };
  });
}
