// Pure view helpers over the live snapshot (client and server).
import type { MatchCardData } from "@/components/pp/match-card";
import { matchLabel } from "@/lib/live-labels";
import type { AuthedExtras, LiveMatch, LiveTable, LiveTeam, PublicSnapshot } from "@/lib/live-types";

/** Public snapshot, plus the personal extras when signed in. */
export type AnySnapshot = PublicSnapshot & Partial<AuthedExtras>;

/** Where the live data of a page comes from. */
export type LiveMode = "authed" | "public" | "static";

/** Who is looking: guest, signed-in member, or signed in but the initial password is still set. */
export type Viewer = "guest" | "member" | "mustChangePassword";

export const liveEndpoint: Record<Exclude<LiveMode, "static">, string> = {
  authed: "/api/live",
  public: "/api/live/public",
};

export const TOURNAMENT_TABS = ["gruppen", "ko", "spielplan"] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number];

export type SnapshotIndex = {
  teamById: Map<string, LiveTeam>;
  matchById: Map<string, LiveMatch>;
  matchByCode: Map<string, LiveMatch>;
};

export function indexSnapshot(s: Pick<PublicSnapshot, "teams" | "matches">): SnapshotIndex {
  return {
    teamById: new Map(s.teams.map((t) => [t.id, t])),
    matchById: new Map(s.matches.map((m) => [m.id, m])),
    matchByCode: new Map(s.matches.map((m) => [m.code, m])),
  };
}

export function teamOf(idx: SnapshotIndex, id: string | null): LiveTeam | null {
  return id ? (idx.teamById.get(id) ?? null) : null;
}

export function isDecided(m: Pick<LiveMatch, "status">): boolean {
  return m.status === "COMPLETED" || m.status === "FORFEITED";
}

/** Timer is shown while a match is on the clock (running, paused or over time, not yet ended). */
export function isClockRunning(m: Pick<LiveMatch, "status" | "timer">): boolean {
  return m.status === "IN_PROGRESS" && !!m.timer?.startedAt && m.timer.endedAt == null;
}

/**
 * MatchCard renders "W:<x>" as "Sieger <x>" with the raw code ("Sieger QF1"). Until it uses
 * @/lib/live-labels, hand it the German match name instead ("W:Viertelfinal 1" →
 * "Sieger Viertelfinal 1"). Group sources ("A1") already render as "1. Gruppe A".
 */
export function cardSource(source: string | null): string | null {
  const w = source ? /^W:(QF\d+|SF\d+|F)$/.exec(source) : null;
  return w ? `W:${matchLabel(w[1], "KNOCKOUT", 0, null)}` : source;
}

export function toCardData(m: LiveMatch, idx: SnapshotIndex, label?: string): MatchCardData {
  const home = teamOf(idx, m.homeTeamId);
  const away = teamOf(idx, m.awayTeamId);
  return {
    id: m.id,
    code: m.code,
    label: label ?? m.label,
    status: m.status,
    home: home ? { id: home.id, name: home.name, logoUrl: home.logoUrl } : null,
    away: away ? { id: away.id, name: away.name, logoUrl: away.logoUrl } : null,
    homeSource: cardSource(m.homeSource),
    awaySource: cardSource(m.awaySource),
    tableNumber: m.tableNumber,
    winnerTeamId: m.result?.winnerTeamId ?? null,
    homeCupsRemaining: m.result?.homeCupsRemaining ?? null,
    awayCupsRemaining: m.result?.awayCupsRemaining ?? null,
  };
}

const stageRank = (m: LiveMatch) => (m.stage === "GROUP" ? 0 : 1);

/** Play order: group stage first, then round, then the scheduler's order index. */
export function byPlayOrder(a: LiveMatch, b: LiveMatch): number {
  return stageRank(a) - stageRank(b) || a.round - b.round || a.orderIndex - b.orderIndex;
}

/** Matches on a table right now (assigned, running or awaiting confirmation), by table number. */
export function tableMatch(idx: SnapshotIndex, table: LiveTable): LiveMatch | null {
  return table.currentMatchId ? (idx.matchById.get(table.currentMatchId) ?? null) : null;
}

/**
 * Rough queue position of a match that is not yet on a table: how many matches are
 * expected before it. Uses the server's upNext order first, then play order.
 * Returns null when the match is on a table, decided or unknown.
 */
export function matchesAhead(s: Pick<PublicSnapshot, "matches" | "upNext">, matchId: string): number | null {
  const m = s.matches.find((x) => x.id === matchId);
  if (!m || (m.status !== "READY" && m.status !== "PENDING")) return null;
  const upNext = s.upNext.filter((id) => s.matches.some((x) => x.id === id));
  const i = upNext.indexOf(matchId);
  if (i !== -1) return i;
  const rest = s.matches
    .filter((x) => (x.status === "READY" || x.status === "PENDING") && !upNext.includes(x.id))
    .sort(byPlayOrder);
  const j = rest.findIndex((x) => x.id === matchId);
  return j === -1 ? null : upNext.length + j;
}

export function playedCount(s: Pick<PublicSnapshot, "matches">): { done: number; total: number } {
  const relevant = s.matches.filter((m) => m.status !== "CANCELLED");
  return { done: relevant.filter(isDecided).length, total: relevant.length };
}

const zurichTimeFmt = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});
const zurichYearFmt = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", year: "numeric" });

/** "21:07" in Europe/Zurich. */
export function zurichTime(ms: number): string {
  return zurichTimeFmt.format(new Date(ms));
}

export function zurichYear(ms: number): string {
  return zurichYearFmt.format(new Date(ms));
}

/** "Seit 21:07" style hint for a match, or null. */
export function matchTimeInfo(m: LiveMatch): string | null {
  const t = m.timer;
  if (!t?.startedAt) return null;
  if (t.endedAt) return `${zurichTime(t.startedAt)}–${zurichTime(t.endedAt)} Uhr`;
  return `Gestartet ${zurichTime(t.startedAt)} Uhr`;
}
