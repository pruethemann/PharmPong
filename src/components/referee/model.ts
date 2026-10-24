// View-model helpers for the referee dashboard (pure, client-safe).
import type { AuthedSnapshot, LiveMatch, LiveTable, LiveTeam } from "@/lib/live-types";
import { computeTimer } from "@/server/domain/timer";
import { matchLabel } from "@/lib/live-labels";

export type MatchOps = NonNullable<AuthedSnapshot["matchOps"]>[string];

export type TablePhase =
  "DISABLED" | "FREE_SUGGESTION" | "FREE_EMPTY" | "ASSIGNED" | "IN_PROGRESS" | "AWAITING_CONFIRMATION";

export function teamById(snap: AuthedSnapshot, id: string | null | undefined): LiveTeam | null {
  if (!id) return null;
  return snap.teams.find((t) => t.id === id) ?? null;
}

export function matchById(snap: AuthedSnapshot, id: string | null | undefined): LiveMatch | null {
  if (!id) return null;
  return snap.matches.find((m) => m.id === id) ?? null;
}

export function suggestionFor(snap: AuthedSnapshot, tableId: string): LiveMatch | null {
  const s = snap.suggestions?.find((x) => x.tableId === tableId);
  return s ? matchById(snap, s.matchId) : null;
}

export function currentMatch(snap: AuthedSnapshot, table: LiveTable): LiveMatch | null {
  return matchById(snap, table.currentMatchId);
}

export function tablePhase(snap: AuthedSnapshot, table: LiveTable): TablePhase {
  const m = currentMatch(snap, table);
  if (m) {
    if (m.status === "ASSIGNED") return "ASSIGNED";
    if (m.status === "IN_PROGRESS") return "IN_PROGRESS";
    if (m.status === "AWAITING_CONFIRMATION") return "AWAITING_CONFIRMATION";
  }
  if (table.state === "DISABLED") return "DISABLED";
  return suggestionFor(snap, table.id) ? "FREE_SUGGESTION" : "FREE_EMPTY";
}

/** Does this table need the referee's attention right now? */
export function needsAction(snap: AuthedSnapshot, table: LiveTable, nowMs: number): boolean {
  const phase = tablePhase(snap, table);
  if (phase === "FREE_SUGGESTION" || phase === "ASSIGNED" || phase === "AWAITING_CONFIRMATION") return true;
  const m = currentMatch(snap, table);
  if (m && snap.matchOps?.[m.id]?.openIssue != null) return true;
  if (phase === "IN_PROGRESS" && m?.timer) return computeTimer(m.timer, nowMs).isOverTime;
  return false;
}

/** Referees never officiate their own team (admins may). */
export function isOwnMatch(snap: AuthedSnapshot, m: LiveMatch | null): boolean {
  if (!m || snap.me.role === "ADMIN" || !snap.me.teamId) return false;
  return m.homeTeamId === snap.me.teamId || m.awayTeamId === snap.me.teamId;
}

const zurichTime = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(ms: number | null | undefined): string {
  return ms ? zurichTime.format(new Date(ms)) : "–";
}

/** "Halbfinal 1" for a next match code. */
export function nextLabelOf(code: string | null): string | null {
  return code ? matchLabel(code, "KNOCKOUT", 0, null) : null;
}
