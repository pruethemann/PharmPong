// Read models for Elo pages that the live snapshot does not cover: one match's full story
// (timeline and result history), a player's profile (rating progression, recent matches,
// teammates, opponents) and the admin lists. Display names only, never e-mail addresses.
import { db, type Db } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { DEFAULT_ELO_PARAMS, DEFAULT_SESSION_SETTINGS } from "@/server/domain/elo/config";
import { rankPlayers } from "@/server/domain/elo/ranking";
import type { EloMatchStatus, EloParams, Side } from "@/server/domain/elo/types";
import { currentEloSession } from "./elo-core";
import { activeRun, paramsOfRun } from "./elo-ratings";
import { getCurrentTournamentId } from "./tx";

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

export type EloMatchDetail = {
  id: string;
  sessionId: string;
  sessionName: string;
  status: EloMatchStatus;
  rated: boolean;
  tableNumber: number;
  tableName: string;
  createdAt: number;
  sides: Record<Side, { userId: string; displayName: string; ratingAtStart: number | null }[]>;
  timer: {
    startedAt: number | null;
    pausedAt: number | null;
    endedAt: number | null;
    pausedDurationMs: number;
  } | null;
  result: {
    winnerSide: Side;
    endType: "REGULAR" | "CONCEDED";
    cupsRemainingA: number | null;
    cupsRemainingB: number | null;
    sequence: number | null;
    multiplier: number | null;
    expectedScoreA: number | null;
    confirmedAt: number | null;
  } | null;
  ratingChanges: {
    userId: string;
    displayName: string;
    side: Side;
    ratingBefore: number;
    delta: number;
    ratingAfter: number;
    expectedScore: number;
  }[];
  events: { id: string; type: string; at: number; actorName: string | null; payload: unknown }[];
  revisions: {
    revision: number;
    kind: string;
    status: EloMatchStatus;
    winnerSide: Side | null;
    rated: boolean;
    at: number;
    actorName: string | null;
    reason: string | null;
  }[];
  cancelReason: string | null;
  disputeNote: string | null;
};

export async function getEloMatchDetail(matchId: string, client: Db = db): Promise<EloMatchDetail> {
  const m = await client.eloMatch.findUnique({
    where: { id: matchId },
    include: {
      session: { select: { id: true, name: true } },
      table: { select: { number: true, name: true } },
      participants: {
        orderBy: [{ side: "asc" }, { position: "asc" }],
        include: { user: { select: { displayName: true } } },
      },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      revisions: { orderBy: { revision: "asc" } },
    },
  });
  if (!m) fail("NOT_FOUND", "Match nicht gefunden.");
  const run = await activeRun(client, m.sessionId);
  const changes = await client.eloRatingChange.findMany({
    where: { runId: run.id, matchId },
    orderBy: [{ side: "asc" }, { userId: "asc" }],
  });
  const actorIds = [...m.events.map((e) => e.actorId), ...m.revisions.map((r) => r.actorId)].filter(
    (x): x is string => !!x,
  );
  const names = new Map(m.participants.map((p) => [p.userId, p.user.displayName]));
  const missing = [...new Set(actorIds)].filter((id) => !names.has(id));
  if (missing.length) {
    for (const u of await client.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, displayName: true },
    })) {
      names.set(u.id, u.displayName);
    }
  }
  const side = (s: Side) =>
    m.participants
      .filter((p) => p.side === s)
      .map((p) => ({ userId: p.userId, displayName: p.user.displayName, ratingAtStart: p.ratingAtStart }));
  return {
    id: m.id,
    sessionId: m.session.id,
    sessionName: m.session.name,
    status: m.status,
    rated: m.rated,
    tableNumber: m.table.number,
    tableName: m.table.name,
    createdAt: m.createdAt.getTime(),
    sides: { A: side("A"), B: side("B") },
    timer: m.startedAt
      ? {
          startedAt: ms(m.startedAt),
          pausedAt: ms(m.pausedAt),
          endedAt: ms(m.endedAt),
          pausedDurationMs: m.pausedDurationMs,
        }
      : null,
    result:
      m.winnerSide && m.endType && (m.status === "COMPLETED" || m.status === "VOIDED")
        ? {
            winnerSide: m.winnerSide,
            endType: m.endType,
            cupsRemainingA: m.cupsRemainingA,
            cupsRemainingB: m.cupsRemainingB,
            sequence: m.confirmedSequence,
            multiplier: m.ratingMultiplier,
            expectedScoreA: m.expectedScoreA,
            confirmedAt: ms(m.confirmedAt),
          }
        : null,
    ratingChanges: changes.map((c) => ({
      userId: c.userId,
      displayName: names.get(c.userId) ?? "?",
      side: c.side,
      ratingBefore: c.ratingBefore,
      delta: c.delta,
      ratingAfter: c.ratingAfter,
      expectedScore: c.expectedScore,
    })),
    events: m.events.map((e) => ({
      id: e.id,
      type: e.type,
      at: e.createdAt.getTime(),
      actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
      payload: e.payload,
    })),
    revisions: m.revisions.map((r) => ({
      revision: r.revision,
      kind: r.kind,
      status: r.status,
      winnerSide: r.winnerSide,
      rated: r.rated,
      at: r.createdAt.getTime(),
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      reason: r.reason,
    })),
    cancelReason: m.cancelReason,
    disputeNote: m.disputeNote,
  };
}

export type EloPlayerProfile = {
  userId: string;
  displayName: string;
  session: { id: string; name: string; status: "OPEN" | "PAUSED" | "CLOSED" } | null;
  initialRating: number;
  rating: number;
  rank: number | null;
  players: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  peakRating: number;
  lowestRating: number;
  provisional: boolean;
  eligible: boolean;
  minGamesForChampion: number;
  /** Rating after each effective-rated match (active calculation run), oldest first. */
  history: { sequence: number; matchId: string; at: number; delta: number; ratingAfter: number }[];
  recentMatches: {
    matchId: string;
    at: number;
    rated: boolean;
    won: boolean;
    delta: number | null;
    multiplier: number | null;
    tableNumber: number;
    teammates: string[];
    opponents: string[];
  }[];
  teammates: { userId: string; displayName: string; matches: number }[];
  opponents: { userId: string; displayName: string; matches: number; won: number }[];
};

/** Profile in the current session (or `sessionId`); null if the user does not exist. */
export async function getEloPlayerProfile(
  userId: string,
  opts: { sessionId?: string; tournamentId?: string; client?: Db } = {},
): Promise<EloPlayerProfile | null> {
  const client = opts.client ?? db;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, displayName: true },
  });
  if (!user) return null;
  const tournamentId = opts.tournamentId ?? (await getCurrentTournamentId(client));
  const session = opts.sessionId
    ? await client.eloSession.findUnique({ where: { id: opts.sessionId } })
    : tournamentId
      ? await currentEloSession(client, tournamentId)
      : null;
  const empty: EloPlayerProfile = {
    userId: user.id,
    displayName: user.displayName,
    session: session ? { id: session.id, name: session.name, status: session.status } : null,
    initialRating: 100,
    rating: 100,
    rank: null,
    players: 0,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    peakRating: 100,
    lowestRating: 100,
    provisional: true,
    eligible: false,
    minGamesForChampion: session?.minGamesForChampion ?? 3,
    history: [],
    recentMatches: [],
    teammates: [],
    opponents: [],
  };
  if (!session) return empty;
  const run = await activeRun(client, session.id);
  const [ratings, changes, played] = await Promise.all([
    client.eloPlayerRating.findMany({ where: { sessionId: session.id } }),
    client.eloRatingChange.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } }),
    client.eloMatch.findMany({
      where: { sessionId: session.id, status: "COMPLETED", participants: { some: { userId } } },
      orderBy: { confirmedSequence: "desc" },
      include: {
        table: { select: { number: true } },
        participants: { include: { user: { select: { displayName: true } } } },
      },
    }),
  ]);
  const ranked = rankPlayers(ratings, {
    minGamesForChampion: session.minGamesForChampion,
    initialRating: run.initialRating,
  });
  const mine = ranked.find((r) => r.userId === userId);
  const myChanges = changes.filter((c) => c.userId === userId);
  const deltaOf = new Map(myChanges.map((c) => [c.matchId, c.delta]));
  const confirmedAt = new Map(played.map((m) => [m.id, m.confirmedAt?.getTime() ?? 0]));
  const team = new Map<string, { displayName: string; matches: number }>();
  const opp = new Map<string, { displayName: string; matches: number; won: number }>();
  const recent: EloPlayerProfile["recentMatches"] = [];
  for (const m of played) {
    const me = m.participants.find((p) => p.userId === userId)!;
    const won = m.winnerSide === me.side;
    const mates = m.participants.filter((p) => p.side === me.side && p.userId !== userId);
    const others = m.participants.filter((p) => p.side !== me.side);
    for (const p of mates) {
      const t = team.get(p.userId) ?? { displayName: p.user.displayName, matches: 0 };
      t.matches++;
      team.set(p.userId, t);
    }
    for (const p of others) {
      const o = opp.get(p.userId) ?? { displayName: p.user.displayName, matches: 0, won: 0 };
      o.matches++;
      if (won) o.won++;
      opp.set(p.userId, o);
    }
    if (recent.length < 10) {
      recent.push({
        matchId: m.id,
        at: m.confirmedAt?.getTime() ?? m.createdAt.getTime(),
        rated: m.rated,
        won,
        delta: deltaOf.get(m.id) ?? null,
        multiplier: m.ratingMultiplier,
        tableNumber: m.table.number,
        teammates: mates.map((p) => p.user.displayName),
        opponents: others.map((p) => p.user.displayName),
      });
    }
  }
  const byCount = <T extends { matches: number; displayName: string }>(a: T, b: T) =>
    b.matches - a.matches || a.displayName.localeCompare(b.displayName, "de-CH");
  return {
    ...empty,
    initialRating: run.initialRating,
    rating: mine?.rating ?? run.initialRating,
    rank: mine?.rank ?? null,
    players: ranked.length,
    gamesPlayed: mine?.gamesPlayed ?? 0,
    wins: mine?.wins ?? 0,
    losses: mine?.losses ?? 0,
    peakRating: mine?.peakRating ?? run.initialRating,
    lowestRating: mine?.lowestRating ?? run.initialRating,
    provisional: mine?.provisional ?? true,
    eligible: mine?.eligible ?? false,
    history: myChanges.map((c) => ({
      sequence: c.sequence,
      matchId: c.matchId,
      at: confirmedAt.get(c.matchId) ?? 0,
      delta: c.delta,
      ratingAfter: c.ratingAfter,
    })),
    recentMatches: recent,
    teammates: [...team].map(([id, t]) => ({ userId: id, ...t })).sort(byCount),
    opponents: [...opp].map(([id, o]) => ({ userId: id, ...o })).sort(byCount),
  };
}

export type EloRulesInfo = {
  params: EloParams;
  minTeamSize: number;
  maxTeamSize: number;
  minGamesForChampion: number;
  softReminderMinutes: number | null;
  resultPolicy: "DUAL_TEAM_CONFIRMATION" | "REFEREE_ONLY";
};

/** Values for the rules page: the current round's settings, else the defaults. */
export async function getEloRulesInfo(tournamentId: string | null, client: Db = db): Promise<EloRulesInfo> {
  const session = tournamentId ? await currentEloSession(client, tournamentId) : null;
  if (!session) {
    return {
      params: DEFAULT_ELO_PARAMS,
      minTeamSize: DEFAULT_SESSION_SETTINGS.minTeamSize,
      maxTeamSize: DEFAULT_SESSION_SETTINGS.maxTeamSize,
      minGamesForChampion: DEFAULT_SESSION_SETTINGS.minGamesForChampion,
      softReminderMinutes: DEFAULT_SESSION_SETTINGS.softReminderMinutes,
      resultPolicy: DEFAULT_SESSION_SETTINGS.resultPolicy,
    };
  }
  return {
    params: paramsOfRun(await activeRun(client, session.id)),
    minTeamSize: session.minTeamSize,
    maxTeamSize: session.maxTeamSize,
    minGamesForChampion: session.minGamesForChampion,
    softReminderMinutes: session.softReminderMinutes,
    resultPolicy: session.resultPolicy,
  };
}

// ─── Admin lists ───────────────────────────────────────────────────────────

export type EloSessionAdmin = {
  id: string;
  name: string;
  status: "OPEN" | "PAUSED" | "CLOSED";
  configVersion: number;
  createdAt: number;
  closedAt: number | null;
  settings: {
    minTeamSize: number;
    maxTeamSize: number;
    minGamesForChampion: number;
    softReminderMinutes: number | null;
    resultPolicy: "DUAL_TEAM_CONFIRMATION" | "REFEREE_ONLY";
  };
  /** Earlier, closed rounds of the same event. */
  closedRounds: number;
};

/** The event's current Elo round with its config version (needed by every admin change). */
export async function getEloSessionAdmin(
  actor: Actor,
  tournamentId: string,
  client: Db = db,
): Promise<EloSessionAdmin | null> {
  assertRole(actor, "ADMIN");
  const s = await currentEloSession(client, tournamentId);
  if (!s) return null;
  const closedRounds = await client.eloSession.count({
    where: { tournamentId, status: "CLOSED", id: { not: s.id } },
  });
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    configVersion: s.configVersion,
    createdAt: s.createdAt.getTime(),
    closedAt: ms(s.closedAt),
    settings: {
      minTeamSize: s.minTeamSize,
      maxTeamSize: s.maxTeamSize,
      minGamesForChampion: s.minGamesForChampion,
      softReminderMinutes: s.softReminderMinutes,
      resultPolicy: s.resultPolicy,
    },
    closedRounds,
  };
}

export type EloAdminMatchRow = {
  id: string;
  status: EloMatchStatus;
  rated: boolean;
  tableNumber: number;
  sideA: { userId: string; displayName: string }[];
  sideB: { userId: string; displayName: string }[];
  winnerSide: Side | null;
  endType: "REGULAR" | "CONCEDED" | null;
  cupsRemainingA: number | null;
  cupsRemainingB: number | null;
  sequence: number | null;
  multiplier: number | null;
  version: number;
  resultVersion: number;
  createdAt: number;
  confirmedAt: number | null;
  disputeNote: string | null;
  cancelReason: string | null;
};

/** All matches of a session, newest first (ADMIN). */
export async function listEloMatchesAdmin(
  actor: Actor,
  input: { sessionId: string; status?: EloMatchStatus[] },
  client: Db = db,
): Promise<EloAdminMatchRow[]> {
  assertRole(actor, "ADMIN");
  const rows = await client.eloMatch.findMany({
    where: { sessionId: input.sessionId, ...(input.status ? { status: { in: input.status } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      table: { select: { number: true } },
      participants: {
        orderBy: [{ side: "asc" }, { position: "asc" }],
        include: { user: { select: { displayName: true } } },
      },
    },
  });
  return rows.map((m) => {
    const side = (s: Side) =>
      m.participants
        .filter((p) => p.side === s)
        .map((p) => ({ userId: p.userId, displayName: p.user.displayName }));
    return {
      id: m.id,
      status: m.status,
      rated: m.rated,
      tableNumber: m.table.number,
      sideA: side("A"),
      sideB: side("B"),
      winnerSide: m.winnerSide,
      endType: m.endType,
      cupsRemainingA: m.cupsRemainingA,
      cupsRemainingB: m.cupsRemainingB,
      sequence: m.confirmedSequence,
      multiplier: m.ratingMultiplier,
      version: m.version,
      resultVersion: m.resultVersion,
      createdAt: m.createdAt.getTime(),
      confirmedAt: ms(m.confirmedAt),
      disputeNote: m.disputeNote,
      cancelReason: m.cancelReason,
    };
  });
}

export type EloRunRow = {
  id: string;
  revision: number;
  reason: string;
  note: string | null;
  triggeredBy: string | null;
  kFactor: number;
  ratingScale: number;
  initialRating: number;
  repeatMultipliers: number[];
  algorithmVersion: string;
  runtime: string;
  digestAtCreation: string | null;
  createdAt: number;
  supersededAt: number | null;
  changes: number;
};

/** Calculation runs of a session, newest first (ADMIN). */
export async function listEloRuns(actor: Actor, sessionId: string, client: Db = db): Promise<EloRunRow[]> {
  assertRole(actor, "ADMIN");
  const runs = await client.eloRatingRun.findMany({
    where: { sessionId },
    orderBy: { revision: "desc" },
    include: { _count: { select: { changes: true } } },
  });
  const actorIds = runs.map((r) => r.triggeredById).filter((x): x is string => !!x);
  const names = new Map(
    (
      await client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
    ).map((u) => [u.id, u.displayName]),
  );
  return runs.map((r) => ({
    id: r.id,
    revision: r.revision,
    reason: r.reason,
    note: r.note,
    triggeredBy: r.triggeredById ? (names.get(r.triggeredById) ?? null) : null,
    kFactor: r.kFactor,
    ratingScale: r.ratingScale,
    initialRating: r.initialRating,
    repeatMultipliers: r.repeatMultipliers,
    algorithmVersion: r.algorithmVersion,
    runtime: r.runtime,
    digestAtCreation: r.digestAtCreation,
    createdAt: r.createdAt.getTime(),
    supersededAt: ms(r.supersededAt),
    changes: r._count.changes,
  }));
}
