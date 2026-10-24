import { isActiveStatus, isDecidedStatus } from "./match-state";
import type { MatchView, TableView } from "./types";

export type Assignment = { tableId: string; matchId: string };
export type IneligibleReason = "NOT_READY" | "TEAM_BUSY" | "MISSING_TEAMS" | "DECIDED";

const teamsOf = (m: MatchView): string[] =>
  [m.homeTeamId, m.awayTeamId].filter((t): t is string => t !== null);

function busyTeams(matches: MatchView[], exceptMatchId?: string): Set<string> {
  const busy = new Set<string>();
  for (const m of matches) {
    if (m.id !== exceptMatchId && isActiveStatus(m.status)) teamsOf(m).forEach((t) => busy.add(t));
  }
  return busy;
}

const stageRank = (m: MatchView) => (m.stage === "GROUP" ? 0 : 1);

/**
 * Suggests table assignments: earliest READY matches (group stage first, then
 * round, then play order) on free tables in table-number order. Never suggests
 * a busy team or one team twice.
 *
 * There is deliberately no "longest rest" criterion: orderIndex is unique per
 * tournament (1..19), so a rest tie-breaker after it could never take effect.
 * The fixture order itself already interleaves groups so consecutive matches
 * never share a team.
 */
export function suggestAssignments(matches: MatchView[], tables: TableView[]): Assignment[] {
  const occupied = new Set(
    matches.filter((m) => isActiveStatus(m.status) && m.tableId !== null).map((m) => m.tableId),
  );
  const freeTables = tables
    .filter((t) => !t.isDisabled && !occupied.has(t.id))
    .sort((a, b) => a.number - b.number);
  if (freeTables.length === 0) return [];

  const busy = busyTeams(matches);
  const candidates = matches
    .filter(
      (m) =>
        m.status === "READY" &&
        m.homeTeamId !== null &&
        m.awayTeamId !== null &&
        !busy.has(m.homeTeamId) &&
        !busy.has(m.awayTeamId),
    )
    .sort(
      (a, b) =>
        stageRank(a) - stageRank(b) ||
        a.round - b.round ||
        a.orderIndex - b.orderIndex ||
        a.id.localeCompare(b.id),
    );

  const used = new Set<string>();
  const out: Assignment[] = [];
  for (const m of candidates) {
    if (out.length >= freeTables.length) break;
    const teams = teamsOf(m);
    if (teams.some((t) => used.has(t))) continue;
    teams.forEach((t) => used.add(t));
    out.push({ tableId: freeTables[out.length].id, matchId: m.id });
  }
  return out;
}

/** Whether a match may be assigned to a table now (admin override UI). */
export function eligibility(
  matches: MatchView[],
  match: MatchView,
): { eligible: boolean; reason?: IneligibleReason } {
  if (isDecidedStatus(match.status)) return { eligible: false, reason: "DECIDED" };
  if (match.homeTeamId === null || match.awayTeamId === null) {
    return { eligible: false, reason: "MISSING_TEAMS" };
  }
  if (match.status !== "READY") return { eligible: false, reason: "NOT_READY" };
  const busy = busyTeams(matches, match.id);
  if (busy.has(match.homeTeamId) || busy.has(match.awayTeamId)) {
    return { eligible: false, reason: "TEAM_BUSY" };
  }
  return { eligible: true };
}
