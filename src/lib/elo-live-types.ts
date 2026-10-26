// Contract of the Elo live polling API (/api/elo/live, /api/elo/live/public). Same rules as
// live-types.ts: display names only, never e-mail addresses. The full player list for the match
// builder is only part of the authenticated extras.
import type { EloActionFlags } from "@/server/domain/elo/permissions";
import type { RoleKey, TableStateKey } from "@/lib/i18n/de";

export type EloSideKey = "A" | "B";
export type EloMatchStatusKey =
  "DRAFT" | "IN_PROGRESS" | "AWAITING_CONFIRMATION" | "DISPUTED" | "COMPLETED" | "CANCELLED" | "VOIDED";
export type EloEndTypeKey = "REGULAR" | "CONCEDED";
export type EloSessionStatusKey = "OPEN" | "PAUSED" | "CLOSED";
export type EloResultPolicyKey = "DUAL_TEAM_CONFIRMATION" | "REFEREE_ONLY";

export type EloLiveParticipant = {
  userId: string;
  displayName: string;
  side: EloSideKey;
  position: number;
  /** Current session rating (the start rating for players without rated games). */
  rating: number;
  ratingAtStart: number | null;
};

export type EloLiveTimer = {
  startedAt: number | null; // ms epoch, server clock
  pausedAt: number | null;
  endedAt: number | null;
  pausedDurationMs: number;
};

export type EloLiveMatch = {
  id: string;
  status: EloMatchStatusKey;
  rated: boolean;
  tableId: string;
  tableNumber: number;
  tableName: string;
  createdById: string;
  sideA: EloLiveParticipant[];
  sideB: EloLiveParticipant[];
  consentA: boolean;
  consentB: boolean;
  /** Drafts: when the reservation ends (ms epoch). */
  expiresAt: number | null;
  timer: EloLiveTimer | null;
  /** The reported result while it waits for the other side or a referee. */
  report: {
    winnerSide: EloSideKey;
    endType: EloEndTypeKey;
    cupsRemainingA: number | null;
    cupsRemainingB: number | null;
    side: EloSideKey | null;
    byName: string | null;
    at: number | null;
  } | null;
  dispute: { byName: string | null; at: number; note: string | null } | null;
  /** Only COMPLETED matches. */
  result: {
    winnerSide: EloSideKey;
    endType: EloEndTypeKey;
    cupsRemainingA: number | null;
    cupsRemainingB: number | null;
    confirmedAt: number;
    sequence: number;
    multiplier: number | null;
    expectedScoreA: number | null;
  } | null;
  /** Rating changes of a COMPLETED, effectively rated match (active calculation run). */
  ratingChanges: { userId: string; delta: number; ratingAfter: number }[];
  /** Rated drafts and running matches: how the repeat-match rule would count it right now. */
  prospective: { multiplier: number; priorCount: number } | null;
};

export type EloLeaderRow = {
  userId: string;
  displayName: string;
  rank: number;
  rating: number;
  ratingChange: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  provisional: boolean;
  eligible: boolean;
};

export type EloAchievementView = {
  userIds: string[];
  names: string[];
  value: number;
  matchId: string | null;
} | null;

export type EloLiveTable = {
  id: string;
  number: number;
  name: string;
  state: TableStateKey;
  matchId: string | null;
};

export type EloPublicSnapshot = {
  revision: number;
  serverNow: number;
  gameMode: "COMPETITIVE" | "ELO";
  tournament: { id: string; name: string; publicDisplayEnabled: boolean };
  session: {
    id: string;
    name: string;
    status: EloSessionStatusKey;
    createdAt: number;
    closedAt: number | null;
    champions: { userId: string; displayName: string }[];
    settings: {
      minTeamSize: number;
      maxTeamSize: number;
      minGamesForChampion: number;
      softReminderMinutes: number | null;
      resultPolicy: EloResultPolicyKey;
    };
    params: {
      initialRating: number;
      kFactor: number;
      ratingScale: number;
      repeatMultipliers: number[];
      algorithmVersion: string;
      runRevision: number;
    };
  } | null;
  tables: EloLiveTable[];
  leaderboard: EloLeaderRow[];
  /** Unexpired drafts and running matches. */
  liveMatches: EloLiveMatch[];
  /** Reported or disputed results. */
  pendingMatches: EloLiveMatch[];
  /** The latest confirmed matches, newest first. */
  recentMatches: EloLiveMatch[];
  achievements: {
    mostActive: EloAchievementView;
    biggestUpset: EloAchievementView;
    bestComeback: EloAchievementView;
  };
  stats: { completed: number; rated: number; players: number; eligible: number; provisional: number };
  /** Rated meetings so far per normalized pairing key (drives the repeat-match banner). */
  pairCounts: Record<string, number>;
};

export type EloRosterEntry = {
  userId: string;
  displayName: string;
  rating: number;
  gamesPlayed: number;
  /** The live match the player is in (they cannot be added elsewhere). */
  busyMatchId: string | null;
};

export type EloMatchOps = { version: number; resultVersion: number; rosterHash: string; can: EloActionFlags };

export type EloAuthedExtras = {
  me: {
    userId: string;
    displayName: string;
    role: RoleKey;
    rating: number | null;
    rank: number | null;
    liveMatchId: string | null;
    /** Matches waiting for this user: confirm the roster or the reported result. */
    todo: { matchId: string; kind: "CONSENT" | "CONFIRM_RESULT" }[];
  };
  roster: EloRosterEntry[];
  matchOps: Record<string, EloMatchOps>;
  /** Referees and admins. */
  staff?: { disputes: number; pendingResults: number; drafts: number };
};

export type EloAuthedSnapshot = EloPublicSnapshot & EloAuthedExtras;
