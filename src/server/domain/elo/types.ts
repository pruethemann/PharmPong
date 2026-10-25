// PharmaElo (Elo Mode) shared, framework-free types. The pure modules in this folder
// implement the rating maths and match rules over them; services map Prisma rows onto them.

export type Side = "A" | "B";
export const SIDES: readonly Side[] = ["A", "B"];
export const otherSide = (s: Side): Side => (s === "A" ? "B" : "A");

/** Hard limits of a temporary team. Sessions may narrow them (see config.ts). */
export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 4;

/**
 * Rating parameters of one calculation run. They never change silently: a change is a new,
 * audited run that replays the whole session.
 */
export type EloParams = {
  initialRating: number;
  /** Total rating transfer of a match at multiplier 1 (K). */
  kFactor: number;
  /** D in E_A = 1 / (1 + 10^((R_B − R_A) / D)). Chess uses 400; PharmaPong uses 100. */
  ratingScale: number;
  /** Repeat-match multipliers; entry i applies to the (i+1)-th rated meeting, the last one repeats. */
  repeatMultipliers: readonly number[];
};

export type RatedPlayer = { userId: string; rating: number };

export type EloMatchStatus =
  "DRAFT" | "IN_PROGRESS" | "AWAITING_CONFIRMATION" | "DISPUTED" | "COMPLETED" | "CANCELLED" | "VOIDED";

/** Statuses in which a match holds its table and its players (one live match per table and player). */
export const ELO_LIVE_STATUSES: readonly EloMatchStatus[] = ["DRAFT", "IN_PROGRESS"];
/** Statuses that block a mode switch and closing the session (still needing a decision). */
export const ELO_OPEN_STATUSES: readonly EloMatchStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
  "DISPUTED",
];

export type EloResultPolicy = "DUAL_TEAM_CONFIRMATION" | "REFEREE_ONLY";
export type EloEndType = "REGULAR" | "CONCEDED";
export type EloSessionStatus = "OPEN" | "PAUSED" | "CLOSED";
export type EloRole = "PLAYER" | "REFEREE" | "ADMIN";
