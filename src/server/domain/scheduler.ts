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

/** Earlier "last played" first; -Infinity (never played) ties with itself. */
const compareRest = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** End time of each team's most recent decided match (ms). */
function lastPlayedAt(matches: MatchView[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const m of matches) {
    if (!isDecidedStatus(m.status) || m.endedAt === null) continue;
    for (const t of teamsOf(m)) last.set(t, Math.max(last.get(t) ?? -Infinity, m.endedAt));
  }
  return last;
}

/**
 * Suggests table assignments: earliest READY matches on free tables in
 * table-number order (docs/tournament-rules.md §6). Order: group stage first,
 * then the earliest round, then the match whose teams have rested longest
 * (the more recently active of its two teams finished earliest; teams that have
 * not played yet count as fully rested), then play order. Never suggests a busy
 * team or one team twice.
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
  const last = lastPlayedAt(matches);
  const recentOf = (m: MatchView) => Math.max(...teamsOf(m).map((t) => last.get(t) ?? -Infinity));
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
        compareRest(recentOf(a), recentOf(b)) ||
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
