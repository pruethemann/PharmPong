// Live snapshots for the polling API (/api/live, /api/live/public).
// Everything is read in ONE read-only REPEATABLE READ transaction so the
// revision and the data always belong together. The public snapshot is
// memoized per (tournamentId, revision); serverNow is refreshed on every hit.
import { db, type Db, type Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/sessions";
import { isActiveStatus } from "@/server/domain/match-state";
import { suggestAssignments } from "@/server/domain/scheduler";
import { deriveTableState } from "@/server/domain/table-state";
import { Prisma } from "@/generated/prisma/client";
import { matchLabel } from "@/lib/live-labels";
import { parseSince } from "@/lib/live-client";
import type {
  AuthedExtras,
  AuthedSnapshot,
  LiveEvent,
  LiveGroup,
  LiveMatch,
  LiveResponse,
  LiveTable,
  LiveTeam,
  PublicSnapshot,
} from "@/lib/live-types";
import { loadTournamentState, type LoadedMatch, type TournamentState } from "./state";
import { teamLogoUrl } from "./teams";
import { getCurrentTournamentId } from "./tx";

const UP_NEXT_MAX = 4;
const RECENT_EVENTS_MAX = 10;
const ANNOUNCED_EVENT_TYPES = ["ASSIGNED", "STARTED", "ADVANCED", "CHAMPION"] as const;

// ─── Read transaction ──────────────────────────────────────────────────────

/** Read-only REPEATABLE READ transaction (also used by the Elo snapshots). */
export async function readSnapshotTx<T>(fn: (tx: Tx) => Promise<T>, client: Db = db): Promise<T> {
  return client.$transaction(
    async (tx) => {
      // Must run before the first query of the transaction (snapshot not yet taken).
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return fn(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 10000 },
  );
}

export type LiveHead = { revision: number; publicDisplayEnabled: boolean; serverNow: number };

/** Cheap fast-path query: revision + public flag + DB clock. */
export async function readLiveHead(tournamentId: string, client: Db | Tx = db): Promise<LiveHead | null> {
  const rows = await client.$queryRaw<{ revision: number; publicDisplayEnabled: boolean; now: Date }[]>`
    SELECT revision, "publicDisplayEnabled", now() AS now FROM "Tournament" WHERE id = ${tournamentId}`;
  const r = rows[0];
  if (!r) return null;
  return { revision: r.revision, publicDisplayEnabled: r.publicDisplayEnabled, serverNow: r.now.getTime() };
}

async function dbNow(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return rows[0].now.getTime();
}

// ─── Mapping ───────────────────────────────────────────────────────────────

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

function payloadObject(p: Prisma.JsonValue | null): Record<string, unknown> {
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toLiveMatch(m: LoadedMatch, tableNumberById: Map<string, number>, durationSec: number): LiveMatch {
  const r = m.row;
  return {
    id: m.id,
    code: m.code,
    label: matchLabel(m.code, m.stage, m.round, m.group),
    stage: m.stage,
    round: m.round,
    orderIndex: m.orderIndex,
    group: m.group,
    status: m.status,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeSource: m.homeSource,
    awaySource: m.awaySource,
    nextCode: m.nextCode,
    tableNumber: m.tableId ? (tableNumberById.get(m.tableId) ?? null) : null,
    timer: r.startedAt
      ? {
          startedAt: ms(r.startedAt),
          pausedAt: ms(r.pausedAt),
          endedAt: ms(r.endedAt),
          pausedDurationMs: r.pausedDurationMs,
          durationSec,
        }
      : null,
    // MatchView.result is only set for COMPLETED/FORFEITED (confirmed).
    result: m.result
      ? {
          winnerTeamId: m.result.winnerTeamId,
          homeCupsRemaining: m.result.homeCupsRemaining,
          awayCupsRemaining: m.result.awayCupsRemaining,
          endType: m.result.endType,
        }
      : null,
  };
}

function toLiveGroups(state: TournamentState): LiveGroup[] {
  return state.standings.map((s) => ({
    name: s.group,
    complete: s.complete,
    unresolvedTie: s.unresolved.length > 0,
    rows: s.rows.map((row) => ({
      teamId: row.teamId,
      rank: row.rank,
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      points: row.points,
      cupsFor: row.cupsFor,
      cupsAgainst: row.cupsAgainst,
      cupDiff: row.cupDiff,
      provisional: row.provisional,
      decidedBy: row.decidedBy,
      qualified: row.rank === 1 || row.rank === 2,
    })),
  }));
}

function toLiveTables(state: TournamentState): LiveTable[] {
  return state.tables.map((t) => {
    const active = state.matches.find((m) => m.tableId === t.id && isActiveStatus(m.status)) ?? null;
    return {
      id: t.id,
      number: t.number,
      name: t.name,
      state: deriveTableState(t, active),
      currentMatchId: active?.id ?? null,
    };
  });
}

const stageRank = (m: LoadedMatch) => (m.stage === "GROUP" ? 0 : 1);
const playOrder = (a: LoadedMatch, b: LoadedMatch) =>
  stageRank(a) - stageRank(b) || a.round - b.round || a.orderIndex - b.orderIndex;

/** READY (not on a table) in play order, then PENDING knockout matches whose teams are known. */
export function computeUpNext(matches: LoadedMatch[], max = UP_NEXT_MAX): string[] {
  const ready = matches.filter((m) => m.status === "READY").sort(playOrder);
  const pendingKnown = matches
    .filter((m) => m.status === "PENDING" && m.stage === "KNOCKOUT" && m.homeTeamId && m.awayTeamId)
    .sort(playOrder);
  return [...ready, ...pendingKnown].slice(0, max).map((m) => m.id);
}

async function loadTeams(tx: Tx, tournamentId: string): Promise<LiveTeam[]> {
  // Explicit select: never email, invite code or password hash.
  const teams = await tx.team.findMany({
    where: { tournamentId, status: "ACTIVE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
    members: t.members.map((m) => m.user.displayName),
  }));
}

async function loadRecentEvents(tx: Tx, state: TournamentState): Promise<LiveEvent[]> {
  const rows = await tx.matchEvent.findMany({
    where: { tournamentId: state.tournament.id, type: { in: [...ANNOUNCED_EVENT_TYPES] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Quarterfinal advancements are filtered out below; over-fetch a little.
    take: RECENT_EVENTS_MAX * 2,
    select: { id: true, matchId: true, type: true, payload: true, createdAt: true },
  });
  const idByCode = new Map(state.matches.map((m) => [m.code, m.id]));
  const out: LiveEvent[] = [];
  for (const e of rows) {
    const p = payloadObject(e.payload);
    const at = e.createdAt.getTime();
    switch (e.type) {
      case "ASSIGNED":
        out.push({ id: e.id, type: "MATCH_ASSIGNED", matchId: e.matchId, teamId: null, at });
        break;
      case "STARTED":
        out.push({ id: e.id, type: "MATCH_STARTED", matchId: e.matchId, teamId: null, at });
        break;
      case "ADVANCED": {
        const toCode = str(p.toCode);
        const type = toCode?.startsWith("SF")
          ? "ADVANCED_SEMIFINAL"
          : toCode === "F"
            ? "ADVANCED_FINAL"
            : null;
        if (!type || !toCode) break; // advancing into a quarterfinal is not announced
        out.push({ id: e.id, type, matchId: idByCode.get(toCode) ?? e.matchId, teamId: str(p.teamId), at });
        break;
      }
      case "CHAMPION":
        out.push({ id: e.id, type: "CHAMPION", matchId: e.matchId, teamId: str(p.teamId), at });
        break;
    }
  }
  // Oldest first, so clients can play announcements in order.
  return out.slice(0, RECENT_EVENTS_MAX).reverse();
}

async function buildPublicFromState(
  tx: Tx,
  state: TournamentState,
  serverNow: number,
): Promise<PublicSnapshot> {
  const t = state.tournament;
  const [teams, recentEvents] = await Promise.all([loadTeams(tx, t.id), loadRecentEvents(tx, state)]);
  const tableNumberById = new Map(state.tables.map((x) => [x.id, x.number]));
  return {
    revision: t.revision,
    serverNow,
    gameMode: t.gameMode,
    tournament: {
      id: t.id,
      name: t.name,
      status: t.status,
      isPaused: t.isPaused,
      matchDurationSec: t.matchDurationSec,
      bombRuleEnabled: t.bombRuleEnabled,
      championTeamId: t.championTeamId,
      publicDisplayEnabled: t.publicDisplayEnabled,
    },
    teams,
    groups: toLiveGroups(state),
    matches: state.matches.map((m) => toLiveMatch(m, tableNumberById, t.matchDurationSec)),
    tables: toLiveTables(state),
    upNext: computeUpNext(state.matches),
    recentEvents,
  };
}

// ─── Public snapshot memo ──────────────────────────────────────────────────

const PUBLIC_CACHE_MAX = 2;
const publicCache = new Map<string, PublicSnapshot>();
const cacheKey = (tournamentId: string, revision: number) => `${tournamentId}:${revision}`;

function remember(snap: PublicSnapshot): void {
  const key = cacheKey(snap.tournament.id, snap.revision);
  publicCache.delete(key);
  publicCache.set(key, snap);
  while (publicCache.size > PUBLIC_CACHE_MAX) {
    const oldest = publicCache.keys().next().value;
    if (oldest === undefined) break;
    publicCache.delete(oldest);
  }
}

/** Test hook. */
export function clearLiveSnapshotCache(): void {
  publicCache.clear();
}

async function publicFor(tx: Tx, state: TournamentState, serverNow: number): Promise<PublicSnapshot> {
  const cached = publicCache.get(cacheKey(state.tournament.id, state.tournament.revision));
  if (cached) return { ...cached, serverNow };
  const snap = await buildPublicFromState(tx, state, serverNow);
  remember(snap);
  return snap;
}

export async function buildPublicSnapshot(tournamentId: string, client: Db = db): Promise<PublicSnapshot> {
  const head = await readLiveHead(tournamentId, client);
  if (head) {
    const cached = publicCache.get(cacheKey(tournamentId, head.revision));
    if (cached) return { ...cached, serverNow: head.serverNow };
  }
  return readSnapshotTx(async (tx) => {
    const serverNow = await dbNow(tx);
    const state = await loadTournamentState(tx, tournamentId);
    return publicFor(tx, state, serverNow);
  }, client);
}

// ─── Authed snapshot ───────────────────────────────────────────────────────

/** Open issue per match: latest ISSUE_REPORTED newer than the latest ISSUE_RESOLVED. */
async function loadOpenIssues(tx: Tx, tournamentId: string): Promise<Map<string, string>> {
  const rows = await tx.matchEvent.findMany({
    where: { tournamentId, type: { in: ["ISSUE_REPORTED", "ISSUE_RESOLVED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { matchId: true, type: true, payload: true },
  });
  const open = new Map<string, string>();
  for (const e of rows) {
    if (e.type === "ISSUE_REPORTED") open.set(e.matchId, str(payloadObject(e.payload).text) ?? "");
    else open.delete(e.matchId);
  }
  return open;
}

function matchOpsOf(
  state: TournamentState,
  openIssues: Map<string, string>,
): NonNullable<AuthedExtras["matchOps"]> {
  const ops: NonNullable<AuthedExtras["matchOps"]> = {};
  for (const m of state.matches) {
    const r = m.row;
    const proposal =
      r.status === "AWAITING_CONFIRMATION" &&
      r.winnerTeamId &&
      r.homeCupsRemaining != null &&
      r.awayCupsRemaining != null &&
      r.endType
        ? {
            winnerTeamId: r.winnerTeamId,
            homeCupsRemaining: r.homeCupsRemaining,
            awayCupsRemaining: r.awayCupsRemaining,
            endType: r.endType,
            proposedById: r.proposedById,
            proposedAt: ms(r.proposedAt),
          }
        : null;
    ops[m.id] = {
      version: r.version,
      resultRevision: r.resultRevision,
      proposal,
      openIssue: openIssues.get(m.id) ?? null,
    };
  }
  return ops;
}

/** The team's next match that is neither decided nor cancelled, by play order. */
export function nextMatchForTeam(matches: LoadedMatch[], teamId: string | null): string | null {
  if (!teamId) return null;
  const next = matches
    .filter(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.status !== "COMPLETED" &&
        m.status !== "FORFEITED" &&
        m.status !== "CANCELLED",
    )
    .sort((a, b) => a.orderIndex - b.orderIndex)[0];
  return next?.id ?? null;
}

export async function buildAuthedSnapshot(
  user: Pick<SessionUser, "id" | "displayName" | "role">,
  tournamentId: string,
  client: Db = db,
): Promise<AuthedSnapshot> {
  return readSnapshotTx(async (tx) => {
    const serverNow = await dbNow(tx);
    const state = await loadTournamentState(tx, tournamentId);
    const pub = await publicFor(tx, state, serverNow);
    const membership = await tx.teamMember.findFirst({
      where: { tournamentId, userId: user.id, leftAt: null, team: { status: "ACTIVE" } },
      select: { teamId: true },
    });
    const teamId = membership?.teamId ?? null;

    const extras: AuthedExtras = {
      me: { userId: user.id, displayName: user.displayName, role: user.role, teamId },
      myNextMatchId: nextMatchForTeam(state.matches, teamId),
    };
    // Assigning is blocked while the tournament is paused or in Elo Mode.
    const noAssignments = state.tournament.isPaused || state.tournament.gameMode === "ELO";
    if (user.role === "REFEREE" || user.role === "ADMIN") {
      extras.matchOps = matchOpsOf(state, await loadOpenIssues(tx, tournamentId));
      // Referees may put exactly these suggestions on their table.
      extras.suggestions = noAssignments ? [] : suggestAssignments(state.matches, state.tables);
    }
    if (user.role === "ADMIN") {
      extras.admin = {
        suggestions: noAssignments ? [] : suggestAssignments(state.matches, state.tables),
        unresolvedTies: state.standings.flatMap((s) =>
          s.unresolved.map((u) => ({
            group: u.group,
            teamIds: u.teamIds,
            basisHash: u.basisHash,
            positions: u.positions,
          })),
        ),
        pendingConfirmations: state.matches.filter((m) => m.status === "AWAITING_CONFIRMATION").length,
      };
    }
    return { ...pub, ...extras };
  }, client);
}

// ─── HTTP handlers (used by the route files; testable without a request scope) ──

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const notFound = () => json({ error: "NOT_FOUND" }, 404);

function sinceOf(req: Request): number | null {
  return parseSince(new URL(req.url).searchParams.get("since"));
}

export type LiveHandlerOpts = { tournamentId?: string | null; client?: Db };

async function resolveTournament(opts: LiveHandlerOpts): Promise<string | null> {
  if (opts.tournamentId !== undefined) return opts.tournamentId;
  return getCurrentTournamentId(opts.client ?? db);
}

/** GET /api/live/public: 404 unless public display is enabled; no session needed. */
export async function handlePublicLive(req: Request, opts: LiveHandlerOpts = {}): Promise<Response> {
  const tournamentId = await resolveTournament(opts);
  if (!tournamentId) return notFound();
  const head = await readLiveHead(tournamentId, opts.client ?? db);
  if (!head || !head.publicDisplayEnabled) return notFound();
  if (sinceOf(req) === head.revision) {
    const body: LiveResponse<PublicSnapshot> = {
      unchanged: true,
      revision: head.revision,
      serverNow: head.serverNow,
    };
    return json(body);
  }
  const snap = await buildPublicSnapshot(tournamentId, opts.client);
  // The flag may have been switched off between the head read and the snapshot.
  if (!snap.tournament.publicDisplayEnabled) return notFound();
  const body: LiveResponse<PublicSnapshot> = { unchanged: false, ...snap };
  return json(body);
}

/** GET /api/live: requires a signed-in user (401 otherwise). */
export async function handleAuthedLive(
  req: Request,
  user: (Pick<SessionUser, "id" | "displayName" | "role"> & { mustChangePassword?: boolean }) | null,
  opts: LiveHandlerOpts = {},
): Promise<Response> {
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  // The initial password must be changed before any authenticated data is served.
  if (user.mustChangePassword) return json({ error: "FORBIDDEN" }, 403);
  const tournamentId = await resolveTournament(opts);
  if (!tournamentId) return notFound();
  const head = await readLiveHead(tournamentId, opts.client ?? db);
  if (!head) return notFound();
  if (sinceOf(req) === head.revision) {
    const body: LiveResponse<AuthedSnapshot> = {
      unchanged: true,
      revision: head.revision,
      serverNow: head.serverNow,
    };
    return json(body);
  }
  const snap = await buildAuthedSnapshot(user, tournamentId, opts.client);
  const body: LiveResponse<AuthedSnapshot> = { unchanged: false, ...snap };
  return json(body);
}
