// Elo live snapshots for the polling API (/api/elo/live, /api/elo/live/public). Same contract as
// live-snapshot.ts: one read-only REPEATABLE READ transaction per snapshot, the public part
// memoized per (tournament, revision), the cheap fast path on Tournament.revision (every Elo
// write bumps it), and a 404 for the public endpoint unless the admin enabled sharing.
import { db, type Db, type Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/sessions";
import { computeAchievements, type AchievementHolder } from "@/server/domain/elo/achievements";
import { eloMatchActions } from "@/server/domain/elo/permissions";
import { rankPlayers } from "@/server/domain/elo/ranking";
import { multiplierFor, rosterPairKey } from "@/server/domain/elo/repeat";
import { replaySession } from "@/server/domain/elo/replay";
import { deriveEloTableState, isDraftExpired } from "@/server/domain/elo/table-state";
import type { Prisma } from "@/generated/prisma/client";
import { parseSince } from "@/lib/live-client";
import type { LiveResponse } from "@/lib/live-types";
import type {
  EloAchievementView,
  EloAuthedExtras,
  EloAuthedSnapshot,
  EloLiveMatch,
  EloLiveParticipant,
  EloPublicSnapshot,
} from "@/lib/elo-live-types";
import { currentEloSession, eloFacts } from "./elo-core";
import { activeRun, loadReplayEntries, paramsOfRun } from "./elo-ratings";
import { readLiveHead, readSnapshotTx } from "./live-snapshot";
import { getCurrentTournamentId } from "./tx";

const RECENT_MAX = 12;
const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

const matchInclude = {
  participants: {
    orderBy: [{ side: "asc" as const }, { position: "asc" as const }],
    include: { user: { select: { displayName: true } } },
  },
  table: { select: { number: true, name: true } },
} satisfies Prisma.EloMatchInclude;

type MatchWithNames = Prisma.EloMatchGetPayload<{ include: typeof matchInclude }>;

/** Everything both snapshot variants need, read inside one transaction. */
type EloView = {
  pub: EloPublicSnapshot;
  matches: MatchWithNames[];
  /** Locks of live (unexpired) matches: userId → matchId. */
  busy: Map<string, string>;
  ratingByUser: Map<string, { rating: number; gamesPlayed: number }>;
  initialRating: number;
};

async function dbNow(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return rows[0].now.getTime();
}

async function loadEloView(tx: Tx, tournamentId: string, serverNow: number): Promise<EloView> {
  const t = await tx.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { id: true, name: true, revision: true, gameMode: true, publicDisplayEnabled: true },
  });
  const tables = await tx.gameTable.findMany({ where: { tournamentId }, orderBy: { number: "asc" } });
  const session = await currentEloSession(tx, tournamentId);
  const pub: EloPublicSnapshot = {
    revision: t.revision,
    serverNow,
    gameMode: t.gameMode,
    tournament: { id: t.id, name: t.name, publicDisplayEnabled: t.publicDisplayEnabled },
    session: null,
    tables: tables.map((x) => ({
      id: x.id,
      number: x.number,
      name: x.name,
      state: deriveEloTableState(x, null, serverNow),
      matchId: null,
    })),
    leaderboard: [],
    liveMatches: [],
    pendingMatches: [],
    recentMatches: [],
    achievements: { mostActive: null, biggestUpset: null, bestComeback: null },
    stats: { completed: 0, rated: 0, players: 0, eligible: 0, provisional: 0 },
    pairCounts: {},
  };
  if (!session) return { pub, matches: [], busy: new Map(), ratingByUser: new Map(), initialRating: 100 };

  const run = await activeRun(tx, session.id);
  const params = paramsOfRun(run);
  const [open, recent, ratings, entries] = await Promise.all([
    tx.eloMatch.findMany({
      where: {
        sessionId: session.id,
        status: { in: ["DRAFT", "IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"] },
      },
      orderBy: { createdAt: "asc" },
      include: matchInclude,
    }),
    tx.eloMatch.findMany({
      where: { sessionId: session.id, status: "COMPLETED" },
      orderBy: { confirmedSequence: "desc" },
      take: RECENT_MAX,
      include: matchInclude,
    }),
    tx.eloPlayerRating.findMany({
      where: { sessionId: session.id },
      include: { user: { select: { displayName: true } } },
    }),
    loadReplayEntries(tx, session.id),
  ]);
  const live = open.filter((m) => !(m.status === "DRAFT" && isDraftExpired(ms(m.expiresAt), serverNow)));
  const ratingByUser = new Map(
    ratings.map((r) => [r.userId, { rating: r.rating, gamesPlayed: r.gamesPlayed }]),
  );
  const nameOf = new Map<string, string>(ratings.map((r) => [r.userId, r.user.displayName]));
  for (const m of [...open, ...recent])
    for (const p of m.participants) nameOf.set(p.userId, p.user.displayName);
  const ratingOf = (userId: string) => ratingByUser.get(userId)?.rating ?? params.initialRating;

  // Replay (pure, milliseconds): achievements and the repeat counts for the pre-match banner.
  const { state, steps } = replaySession(entries, params);
  const pairCounts = Object.fromEntries(state.pairCounts);
  const missing = [...new Set(steps.flatMap((s) => [...s.sideA, ...s.sideB]))].filter(
    (id) => !nameOf.has(id),
  );
  if (missing.length) {
    for (const u of await tx.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, displayName: true },
    })) {
      nameOf.set(u.id, u.displayName);
    }
  }
  const view = (a: AchievementHolder | null): EloAchievementView =>
    a
      ? {
          userIds: a.userIds,
          names: a.userIds.map((id) => nameOf.get(id) ?? "?"),
          value: a.value,
          matchId: a.matchId,
        }
      : null;
  const ach = computeAchievements(steps, params.initialRating);

  const changes = await tx.eloRatingChange.findMany({
    where: { runId: run.id, matchId: { in: recent.map((m) => m.id) } },
    select: { matchId: true, userId: true, delta: true, ratingAfter: true },
  });
  const changesByMatch = new Map<string, { userId: string; delta: number; ratingAfter: number }[]>();
  for (const c of changes) {
    const list = changesByMatch.get(c.matchId) ?? [];
    list.push({ userId: c.userId, delta: c.delta, ratingAfter: c.ratingAfter });
    changesByMatch.set(c.matchId, list);
  }

  const toLive = (m: MatchWithNames): EloLiveMatch => {
    const part = (side: "A" | "B"): EloLiveParticipant[] =>
      m.participants
        .filter((p) => p.side === side)
        .map((p) => ({
          userId: p.userId,
          displayName: p.user.displayName,
          side: p.side,
          position: p.position,
          rating: ratingOf(p.userId),
          ratingAtStart: p.ratingAtStart,
        }));
    const sideA = part("A");
    const sideB = part("B");
    const facts = eloFacts(m, serverNow);
    const pending = m.status === "AWAITING_CONFIRMATION" || m.status === "DISPUTED";
    const prior =
      pairCounts[
        rosterPairKey(
          sideA.map((p) => p.userId),
          sideB.map((p) => p.userId),
        )
      ] ?? 0;
    return {
      id: m.id,
      status: m.status,
      rated: m.rated,
      tableId: m.tableId,
      tableNumber: m.table.number,
      tableName: m.table.name,
      createdById: m.createdById,
      sideA,
      sideB,
      consentA: facts.consentA,
      consentB: facts.consentB,
      expiresAt: m.status === "DRAFT" ? ms(m.expiresAt) : null,
      timer: m.startedAt
        ? {
            startedAt: ms(m.startedAt),
            pausedAt: ms(m.pausedAt),
            endedAt: ms(m.endedAt),
            pausedDurationMs: m.pausedDurationMs,
          }
        : null,
      report:
        pending && m.winnerSide && m.endType
          ? {
              winnerSide: m.winnerSide,
              endType: m.endType,
              cupsRemainingA: m.cupsRemainingA,
              cupsRemainingB: m.cupsRemainingB,
              side: m.submittedSide,
              byName: m.submittedById ? (nameOf.get(m.submittedById) ?? null) : null,
              at: ms(m.submittedAt),
            }
          : null,
      dispute:
        m.status === "DISPUTED" && m.disputedAt
          ? {
              byName: m.disputedById ? (nameOf.get(m.disputedById) ?? null) : null,
              at: m.disputedAt.getTime(),
              note: m.disputeNote,
            }
          : null,
      result:
        m.status === "COMPLETED" && m.winnerSide && m.endType && m.confirmedAt && m.confirmedSequence
          ? {
              winnerSide: m.winnerSide,
              endType: m.endType,
              cupsRemainingA: m.cupsRemainingA,
              cupsRemainingB: m.cupsRemainingB,
              confirmedAt: m.confirmedAt.getTime(),
              sequence: m.confirmedSequence,
              multiplier: m.ratingMultiplier,
              expectedScoreA: m.expectedScoreA,
            }
          : null,
      ratingChanges: changesByMatch.get(m.id) ?? [],
      prospective:
        m.rated && (m.status === "DRAFT" || m.status === "IN_PROGRESS")
          ? { multiplier: multiplierFor(prior, params.repeatMultipliers), priorCount: prior }
          : null,
    };
  };

  const ranked = rankPlayers(ratings, {
    minGamesForChampion: session.minGamesForChampion,
    initialRating: params.initialRating,
    tieKey: (id) => nameOf.get(id) ?? id,
  });
  const liveOnTable = new Map(
    live.filter((m) => m.status === "DRAFT" || m.status === "IN_PROGRESS").map((m) => [m.tableId, m]),
  );
  const busy = new Map<string, string>();
  for (const m of live) {
    if (m.status === "DRAFT" || m.status === "IN_PROGRESS")
      for (const p of m.participants) busy.set(p.userId, m.id);
  }

  pub.session = {
    id: session.id,
    name: session.name,
    status: session.status,
    createdAt: session.createdAt.getTime(),
    closedAt: ms(session.closedAt),
    champions: session.championUserIds.map((userId) => ({ userId, displayName: nameOf.get(userId) ?? "?" })),
    settings: {
      minTeamSize: session.minTeamSize,
      maxTeamSize: session.maxTeamSize,
      minGamesForChampion: session.minGamesForChampion,
      softReminderMinutes: session.softReminderMinutes,
      resultPolicy: session.resultPolicy,
    },
    params: {
      initialRating: params.initialRating,
      kFactor: params.kFactor,
      ratingScale: params.ratingScale,
      repeatMultipliers: [...params.repeatMultipliers],
      algorithmVersion: run.algorithmVersion,
      runRevision: run.revision,
    },
  };
  pub.tables = tables.map((x) => {
    const m = liveOnTable.get(x.id) ?? null;
    return {
      id: x.id,
      number: x.number,
      name: x.name,
      state: deriveEloTableState(x, m ? { status: m.status, expiresAt: ms(m.expiresAt) } : null, serverNow),
      matchId: m?.id ?? null,
    };
  });
  pub.leaderboard = ranked.map((r) => ({
    userId: r.userId,
    displayName: nameOf.get(r.userId) ?? "?",
    rank: r.rank,
    rating: r.rating,
    ratingChange: r.ratingChange,
    gamesPlayed: r.gamesPlayed,
    wins: r.wins,
    losses: r.losses,
    provisional: r.provisional,
    eligible: r.eligible,
  }));
  pub.liveMatches = live.filter((m) => m.status === "DRAFT" || m.status === "IN_PROGRESS").map(toLive);
  pub.pendingMatches = live
    .filter((m) => m.status === "AWAITING_CONFIRMATION" || m.status === "DISPUTED")
    .map(toLive);
  pub.recentMatches = recent.map(toLive);
  pub.achievements = {
    mostActive: view(ach.mostActive),
    biggestUpset: view(ach.biggestUpset),
    bestComeback: view(ach.bestComeback),
  };
  pub.stats = {
    completed: entries.length,
    rated: steps.filter((s) => s.effective).length,
    players: ranked.length,
    eligible: ranked.filter((r) => r.eligible).length,
    provisional: ranked.filter((r) => r.provisional).length,
  };
  pub.pairCounts = pairCounts;
  return { pub, matches: [...open, ...recent], busy, ratingByUser, initialRating: params.initialRating };
}

// ─── Public snapshot memo ──────────────────────────────────────────────────

const PUBLIC_CACHE_MAX = 2;
const publicCache = new Map<string, EloPublicSnapshot>();

function remember(snap: EloPublicSnapshot): void {
  const key = `${snap.tournament.id}:${snap.revision}`;
  publicCache.delete(key);
  publicCache.set(key, snap);
  while (publicCache.size > PUBLIC_CACHE_MAX) {
    const oldest = publicCache.keys().next().value;
    if (oldest === undefined) break;
    publicCache.delete(oldest);
  }
}

/** Test hook. */
export function clearEloSnapshotCache(): void {
  publicCache.clear();
}

export async function buildEloPublicSnapshot(
  tournamentId: string,
  client: Db = db,
): Promise<EloPublicSnapshot> {
  const head = await readLiveHead(tournamentId, client);
  if (head) {
    const cached = publicCache.get(`${tournamentId}:${head.revision}`);
    if (cached) return { ...cached, serverNow: head.serverNow };
  }
  return readSnapshotTx(async (tx) => {
    const { pub } = await loadEloView(tx, tournamentId, await dbNow(tx));
    remember(pub);
    return pub;
  }, client);
}

// ─── Authed snapshot ───────────────────────────────────────────────────────

export async function buildEloAuthedSnapshot(
  user: Pick<SessionUser, "id" | "displayName" | "role">,
  tournamentId: string,
  client: Db = db,
): Promise<EloAuthedSnapshot> {
  return readSnapshotTx(async (tx) => {
    const serverNow = await dbNow(tx);
    const v = await loadEloView(tx, tournamentId, serverNow);
    remember(v.pub);
    const viewer = { userId: user.id, role: user.role };
    const matchOps: EloAuthedExtras["matchOps"] = {};
    const todo: EloAuthedExtras["me"]["todo"] = [];
    for (const m of v.matches) {
      const can = eloMatchActions(eloFacts(m, serverNow), viewer);
      matchOps[m.id] = { version: m.version, resultVersion: m.resultVersion, rosterHash: m.rosterHash, can };
      if (can.consent) todo.push({ matchId: m.id, kind: "CONSENT" });
      if (can.confirmResult) todo.push({ matchId: m.id, kind: "CONFIRM_RESULT" });
    }
    const users = await tx.user.findMany({
      where: { isActive: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true, displayName: true },
    });
    const me = v.pub.leaderboard.find((r) => r.userId === user.id);
    const extras: EloAuthedExtras = {
      me: {
        userId: user.id,
        displayName: user.displayName,
        role: user.role,
        rating: v.ratingByUser.get(user.id)?.rating ?? (v.pub.session ? v.initialRating : null),
        rank: me?.rank ?? null,
        liveMatchId: v.busy.get(user.id) ?? null,
        todo,
      },
      roster: users.map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        rating: v.ratingByUser.get(u.id)?.rating ?? v.initialRating,
        gamesPlayed: v.ratingByUser.get(u.id)?.gamesPlayed ?? 0,
        busyMatchId: v.busy.get(u.id) ?? null,
      })),
      matchOps,
    };
    if (user.role === "REFEREE" || user.role === "ADMIN") {
      extras.staff = {
        disputes: v.pub.pendingMatches.filter((m) => m.status === "DISPUTED").length,
        pendingResults: v.pub.pendingMatches.filter((m) => m.status === "AWAITING_CONFIRMATION").length,
        drafts: v.pub.liveMatches.filter((m) => m.status === "DRAFT").length,
      };
    }
    return { ...v.pub, ...extras };
  }, client);
}

// ─── HTTP handlers (used by the route files; testable without a request scope) ──

const NO_STORE = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const sinceOf = (req: Request) => parseSince(new URL(req.url).searchParams.get("since"));

export type EloLiveHandlerOpts = { tournamentId?: string | null; client?: Db };

async function resolveTournament(opts: EloLiveHandlerOpts): Promise<string | null> {
  if (opts.tournamentId !== undefined) return opts.tournamentId;
  return getCurrentTournamentId(opts.client ?? db);
}

/** GET /api/elo/live/public: 404 unless the public display is enabled; no session needed. */
export async function handleEloPublicLive(req: Request, opts: EloLiveHandlerOpts = {}): Promise<Response> {
  const tournamentId = await resolveTournament(opts);
  if (!tournamentId) return json({ error: "NOT_FOUND" }, 404);
  const head = await readLiveHead(tournamentId, opts.client ?? db);
  if (!head || !head.publicDisplayEnabled) return json({ error: "NOT_FOUND" }, 404);
  if (sinceOf(req) === head.revision) {
    const body: LiveResponse<EloPublicSnapshot> = {
      unchanged: true,
      revision: head.revision,
      serverNow: head.serverNow,
    };
    return json(body);
  }
  const snap = await buildEloPublicSnapshot(tournamentId, opts.client);
  if (!snap.tournament.publicDisplayEnabled) return json({ error: "NOT_FOUND" }, 404);
  return json({ unchanged: false, ...snap } satisfies LiveResponse<EloPublicSnapshot>);
}

/** GET /api/elo/live: requires a signed-in user (401 otherwise). */
export async function handleEloAuthedLive(
  req: Request,
  user: (Pick<SessionUser, "id" | "displayName" | "role"> & { mustChangePassword?: boolean }) | null,
  opts: EloLiveHandlerOpts = {},
): Promise<Response> {
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  if (user.mustChangePassword) return json({ error: "FORBIDDEN" }, 403);
  const tournamentId = await resolveTournament(opts);
  if (!tournamentId) return json({ error: "NOT_FOUND" }, 404);
  const head = await readLiveHead(tournamentId, opts.client ?? db);
  if (!head) return json({ error: "NOT_FOUND" }, 404);
  if (sinceOf(req) === head.revision) {
    const body: LiveResponse<EloAuthedSnapshot> = {
      unchanged: true,
      revision: head.revision,
      serverNow: head.serverNow,
    };
    return json(body);
  }
  const snap = await buildEloAuthedSnapshot(user, tournamentId, opts.client);
  return json({ unchanged: false, ...snap } satisfies LiveResponse<EloAuthedSnapshot>);
}
