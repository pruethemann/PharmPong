// Shared, framework-free domain types. The pure modules in src/server/domain
// implement logic over these. Services map Prisma rows onto them.

export type GroupName = "A" | "B" | "C" | "D";
export const GROUP_NAMES: readonly GroupName[] = ["A", "B", "C", "D"];

export type Stage = "GROUP" | "KNOCKOUT";
export type Slot = "HOME" | "AWAY";
export type EndType = "REGULAR" | "TIME_LIMIT" | "SHOOTOUT" | "FORFEIT";

export type MatchStatus =
  | "PENDING"
  | "READY"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_CONFIRMATION"
  | "COMPLETED"
  | "CANCELLED"
  | "FORFEITED";

export type TournamentStatus =
  | "DRAFT"
  | "REGISTRATION_OPEN"
  | "REGISTRATION_LOCKED"
  | "GROUP_STAGE"
  | "KNOCKOUT_STAGE"
  | "COMPLETED"
  | "CANCELLED";

/** Statuses in which a match occupies a table and both teams. */
export const ACTIVE_MATCH_STATUSES: readonly MatchStatus[] = [
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
];
/** Statuses with a final, confirmed result. */
export const DECIDED_MATCH_STATUSES: readonly MatchStatus[] = ["COMPLETED", "FORFEITED"];

export const CUPS_PER_SIDE = 10;

export type MatchResult = {
  winnerTeamId: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: EndType;
};

/** Planned fixture produced by the draw (before persistence). */
export type FixtureTemplate = {
  code: string; // "A-1".."D-3", "QF1".."QF4", "SF1", "SF2", "F"
  stage: Stage;
  round: number; // group: 1..3, knockout: 1=QF 2=SF 3=F
  orderIndex: number; // 1..19, global play order
  group: GroupName | null;
  homeTeamId: string | null; // set for group matches, null for knockout
  awayTeamId: string | null;
  homeSource: string | null; // "A1" | "B2" | "W:QF1" ... (knockout only)
  awaySource: string | null;
  nextCode: string | null; // advancement link (knockout only)
  nextSlot: Slot | null;
};

export type DrawResult = {
  groups: Record<GroupName, string[]>; // team ids in draw position order (1..3)
  fixtures: FixtureTemplate[]; // exactly 19
};

/** Minimal match view used by standings, bracket and scheduler. */
export type MatchView = {
  id: string;
  code: string;
  stage: Stage;
  round: number;
  orderIndex: number;
  group: GroupName | null;
  status: MatchStatus;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource: string | null;
  awaySource: string | null;
  nextCode: string | null;
  nextSlot: Slot | null;
  tableId: string | null;
  endedAt: number | null; // ms
  result: MatchResult | null; // only for COMPLETED/FORFEITED (confirmed)
};

export type StandingRow = {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  points: number;
  cupsFor: number;
  cupsAgainst: number;
  cupDiff: number;
  rank: number | null; // null when position is not yet decided (unresolved tie)
  /** True while the group still has unplayed matches. */
  provisional: boolean;
  /** How this team's position was separated from its neighbours. */
  decidedBy: "POINTS" | "CUP_DIFF" | "CUPS_FOR" | "HEAD_TO_HEAD" | "SHOOTOUT" | null;
};

export type TiebreakRecord = {
  teamIds: string[]; // sorted tied set
  orderedTeamIds: string[]; // best first
  basisHash: string;
};

export type UnresolvedTie = {
  group: GroupName;
  teamIds: string[]; // sorted
  basisHash: string; // to be stored with the shootout decision
  positions: number[]; // ranks at stake, e.g. [1,2,3] or [2,3]
};

export type GroupStandings = {
  group: GroupName;
  rows: StandingRow[]; // sorted best first (ties in input order with rank null)
  complete: boolean; // all 3 matches decided and no unresolved tie
  unresolved: UnresolvedTie[];
};

export type Qualifiers = Record<"A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "D1" | "D2", string>;

export type TableView = { id: string; number: number; isDisabled: boolean };
export type TableState = "AVAILABLE" | "RESERVED" | "IN_PROGRESS" | "DISABLED";
