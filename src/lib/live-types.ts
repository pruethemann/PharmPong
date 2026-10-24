// Contract of the live polling API (/api/live, /api/live/public).
// The public snapshot must never contain e-mail addresses, invite codes or other private data.
import type {
  EndTypeKey,
  MatchStatusKey,
  RoleKey,
  TableStateKey,
  TournamentStatusKey,
} from "@/lib/i18n/de";

export type LiveTeam = {
  id: string;
  name: string;
  motto: string | null;
  logoUrl: string | null;
  members: string[]; // display names only
};

export type LiveTimer = {
  startedAt: number | null; // ms epoch, server clock
  pausedAt: number | null;
  endedAt: number | null;
  pausedDurationMs: number;
  durationSec: number;
};

export type LiveMatch = {
  id: string;
  code: string; // "A-1".."D-3", "QF1".., "SF1", "SF2", "F"
  label: string; // German, e.g. "Gruppe A · Runde 1", "Viertelfinal 1", "Final"
  stage: "GROUP" | "KNOCKOUT";
  round: number;
  orderIndex: number;
  group: string | null;
  status: MatchStatusKey;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource: string | null;
  awaySource: string | null;
  nextCode: string | null;
  tableNumber: number | null;
  timer: LiveTimer | null;
  /** Only confirmed results (COMPLETED/FORFEITED). */
  result: {
    winnerTeamId: string;
    homeCupsRemaining: number;
    awayCupsRemaining: number;
    endType: EndTypeKey;
  } | null;
};

export type LiveStandingRow = {
  teamId: string;
  rank: number | null;
  played: number;
  wins: number;
  losses: number;
  points: number;
  cupsFor: number;
  cupsAgainst: number;
  cupDiff: number;
  provisional: boolean;
  decidedBy: string | null;
  qualified: boolean; // currently in top 2 (final only when the group is complete)
};

export type LiveGroup = {
  name: string;
  rows: LiveStandingRow[];
  complete: boolean;
  unresolvedTie: boolean;
};

export type LiveTable = {
  id: string;
  number: number;
  name: string;
  state: TableStateKey;
  currentMatchId: string | null;
};

export type LiveEvent = {
  /** Increasing id for display announcements (new match on table, advancement, champion). */
  id: string;
  type: "MATCH_STARTED" | "MATCH_ASSIGNED" | "ADVANCED_SEMIFINAL" | "ADVANCED_FINAL" | "CHAMPION";
  matchId: string | null;
  teamId: string | null;
  at: number;
};

export type PublicSnapshot = {
  revision: number;
  serverNow: number;
  tournament: {
    id: string;
    name: string;
    status: TournamentStatusKey;
    isPaused: boolean;
    matchDurationSec: number;
    bombRuleEnabled: boolean;
    championTeamId: string | null;
    publicDisplayEnabled: boolean;
  };
  teams: LiveTeam[];
  groups: LiveGroup[];
  matches: LiveMatch[];
  tables: LiveTable[];
  /** Up to 4 next matches in suggested play order (READY first, then PENDING with known teams). */
  upNext: string[];
  recentEvents: LiveEvent[];
};

export type AuthedExtras = {
  me: {
    userId: string;
    displayName: string;
    role: RoleKey;
    teamId: string | null;
  };
  myNextMatchId: string | null;
  /** Referee/admin only: per match concurrency + proposal data. */
  matchOps?: Record<
    string,
    {
      version: number;
      resultRevision: number;
      proposal: {
        winnerTeamId: string;
        homeCupsRemaining: number;
        awayCupsRemaining: number;
        endType: EndTypeKey;
        proposedById: string | null;
        proposedAt: number | null;
      } | null;
      openIssue: string | null;
    }
  >;
  /** Admin only. */
  admin?: {
    suggestions: { tableId: string; matchId: string }[];
    unresolvedTies: { group: string; teamIds: string[]; basisHash: string; positions: number[] }[];
    pendingConfirmations: number;
  };
};

export type AuthedSnapshot = PublicSnapshot & AuthedExtras;

export type LiveResponse<T> = { unchanged: true; revision: number; serverNow: number } | ({ unchanged: false } & T);
