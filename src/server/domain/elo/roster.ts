// Temporary Elo teams: a roster is a snapshot of two sides with 1–4 players each.
// No persistent team entity exists; validation runs on the server and, for instant
// feedback, in the match builder.
import { fail } from "../errors";
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE, type Side } from "./types";

export type TeamSizeLimits = { minTeamSize: number; maxTeamSize: number };
export const HARD_TEAM_LIMITS: TeamSizeLimits = { minTeamSize: MIN_TEAM_SIZE, maxTeamSize: MAX_TEAM_SIZE };

export type RosterIssue =
  | { code: "INVALID_PLAYER_ID" }
  | { code: "SIDE_EMPTY"; side: Side }
  | { code: "SIDE_TOO_SMALL"; side: Side; min: number }
  | { code: "SIDE_TOO_LARGE"; side: Side; max: number }
  | { code: "DUPLICATE_PLAYER"; userId: string };

/** Session limits narrowed to the hard 1..4 range. */
function effective(limits: TeamSizeLimits): TeamSizeLimits {
  return {
    minTeamSize: Math.max(MIN_TEAM_SIZE, limits.minTeamSize),
    maxTeamSize: Math.min(MAX_TEAM_SIZE, limits.maxTeamSize),
  };
}

/** All problems of a roster, in a stable order (empty array = valid). */
export function rosterIssues(
  sideA: readonly string[],
  sideB: readonly string[],
  limits: TeamSizeLimits = HARD_TEAM_LIMITS,
): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const { minTeamSize, maxTeamSize } = effective(limits);
  const all = [...sideA, ...sideB];
  if (all.some((id) => typeof id !== "string" || id.trim() === "")) {
    issues.push({ code: "INVALID_PLAYER_ID" });
  }
  for (const [side, ids] of [
    ["A", sideA],
    ["B", sideB],
  ] as const) {
    if (ids.length === 0) issues.push({ code: "SIDE_EMPTY", side });
    else if (ids.length < minTeamSize) issues.push({ code: "SIDE_TOO_SMALL", side, min: minTeamSize });
    if (ids.length > maxTeamSize) issues.push({ code: "SIDE_TOO_LARGE", side, max: maxTeamSize });
  }
  const seen = new Set<string>();
  for (const id of all) {
    if (seen.has(id)) {
      issues.push({ code: "DUPLICATE_PLAYER", userId: id });
      break;
    }
    seen.add(id);
  }
  return issues;
}

/** German text for a roster problem (shared by server errors and the match builder). */
export function rosterIssueMessage(issue: RosterIssue): string {
  switch (issue.code) {
    case "INVALID_PLAYER_ID":
      return "Ungültige Spieler:in in der Aufstellung.";
    case "SIDE_EMPTY":
      return `Team ${issue.side} braucht mindestens eine Spieler:in.`;
    case "SIDE_TOO_SMALL":
      return `Team ${issue.side} braucht mindestens ${issue.min} Spieler:innen.`;
    case "SIDE_TOO_LARGE":
      return `Team ${issue.side} darf höchstens ${issue.max} Spieler:innen haben.`;
    case "DUPLICATE_PLAYER":
      return "Jede Person spielt nur einmal mit: nicht doppelt und nicht in beiden Teams.";
  }
}

/** Throws VALIDATION for the first roster problem. */
export function assertValidRoster(
  sideA: readonly string[],
  sideB: readonly string[],
  limits: TeamSizeLimits = HARD_TEAM_LIMITS,
): void {
  const [first] = rosterIssues(sideA, sideB, limits);
  if (first) fail("VALIDATION", rosterIssueMessage(first), { field: "roster", issue: first.code });
}

/** The side a user plays on, or null. */
export function sideOfUser(
  roster: { sideA: readonly string[]; sideB: readonly string[] },
  userId: string,
): Side | null {
  if (roster.sideA.includes(userId)) return "A";
  if (roster.sideB.includes(userId)) return "B";
  return null;
}

/**
 * Order-independent description of what players consent to: both sides (sorted) and whether
 * the match is rated. The service hashes its stable JSON; any change invalidates consent.
 */
export function canonicalRoster(
  sideA: readonly string[],
  sideB: readonly string[],
  rated: boolean,
): { A: string[]; B: string[]; rated: boolean } {
  return { A: [...sideA].sort(), B: [...sideB].sort(), rated };
}
