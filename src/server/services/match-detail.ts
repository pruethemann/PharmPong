// Read model for the public match detail page (/matches/[id]).
// Never exposes e-mail addresses, user ids or actor information. Issue reports
// (ISSUE_*) are only included for referees/admins (`includeIssues`).
import "server-only";
import { db, type Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { EndTypeKey, MatchStatusKey } from "@/lib/i18n/de";
import { matchLabel, sourceLabel } from "@/lib/live-labels";
import type { LiveTimer } from "@/lib/live-types";
import { teamLogoUrl } from "./teams";

export type MatchDetailTeam = {
  id: string;
  name: string;
  motto: string | null;
  logoUrl: string | null;
  members: string[]; // display names only
};

export type MatchTimelineEntry = {
  id: string;
  type: string;
  label: string;
  /** Extra public detail, e.g. "Tisch 1" or "3 : 0 Becher übrig". */
  detail: string | null;
  at: number; // ms epoch
  tone: "neutral" | "live" | "warning" | "success" | "danger" | "gold";
};

export type MatchDetail = {
  id: string;
  tournamentId: string;
  code: string;
  label: string;
  stage: "GROUP" | "KNOCKOUT";
  round: number;
  group: string | null;
  status: MatchStatusKey;
  tableNumber: number | null;
  home: MatchDetailTeam | null;
  away: MatchDetailTeam | null;
  /** German placeholder text for empty slots ("Sieger Viertelfinal 1"). */
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  nextCode: string | null;
  nextLabel: string | null;
  /** Only confirmed results (COMPLETED / FORFEITED). */
  result: {
    winnerTeamId: string;
    homeCupsRemaining: number;
    awayCupsRemaining: number;
    endType: EndTypeKey;
  } | null;
  timer: LiveTimer | null;
  startedAt: number | null;
  endedAt: number | null;
  confirmedAt: number | null;
  publicDisplayEnabled: boolean;
  championTeamId: string | null;
  timeline: MatchTimelineEntry[];
};

const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

function obj(p: Prisma.JsonValue | null): Record<string, unknown> {
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function codeLabel(code: string | null): string | null {
  if (!code) return null;
  if (code === "F") return "Final";
  const ko = /^(QF|SF)\d+$/.test(code);
  if (ko) return matchLabel(code, "KNOCKOUT", 0, null);
  return code;
}

function scoreOf(p: Record<string, unknown>): string | null {
  const h = num(p.homeCupsRemaining);
  const a = num(p.awayCupsRemaining);
  return h != null && a != null ? `${h} : ${a} Becher übrig` : null;
}

const teamSelect = {
  id: true,
  name: true,
  motto: true,
  logoKey: true,
  logoVersion: true,
  members: {
    where: { leftAt: null },
    orderBy: { slot: "asc" },
    select: { user: { select: { displayName: true } } },
  },
} satisfies Prisma.TeamSelect;

type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

const toTeam = (t: TeamRow | null): MatchDetailTeam | null =>
  t
    ? {
        id: t.id,
        name: t.name,
        motto: t.motto,
        logoUrl: teamLogoUrl(t),
        members: t.members.map((m) => m.user.displayName),
      }
    : null;

type RawEvent = {
  id: string;
  type: string;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  matchId: string;
};

/** Map a stored MatchEvent to a public timeline entry (null = hidden). */
export function timelineEntry(
  e: RawEvent,
  ctx: { matchId: string; teamName: (id: string | null) => string | null; includeIssues: boolean },
): MatchTimelineEntry | null {
  const p = obj(e.payload);
  const base = { id: e.id, type: e.type, at: e.createdAt.getTime() };
  switch (e.type) {
    case "ASSIGNED": {
      const n = num(p.tableNumber);
      return { ...base, label: "Zugewiesen", detail: n != null ? `Tisch ${n}` : null, tone: "neutral" };
    }
    case "UNASSIGNED":
      return { ...base, label: "Tischzuweisung aufgehoben", detail: null, tone: "neutral" };
    case "STARTED":
      return { ...base, label: "Gestartet", detail: null, tone: "live" };
    case "PAUSED":
      return {
        ...base,
        label: "Pausiert",
        detail: p.cause === "TOURNAMENT" ? "Turnierpause" : null,
        tone: "warning",
      };
    case "RESUMED":
      return { ...base, label: "Fortgesetzt", detail: null, tone: "live" };
    case "PROPOSED":
      return { ...base, label: "Resultat erfasst", detail: "Wartet auf Bestätigung", tone: "warning" };
    case "REJECTED":
      return { ...base, label: "Erfassung korrigiert", detail: "Resultat wird neu erfasst", tone: "neutral" };
    case "CONFIRMED":
      return { ...base, label: "Resultat bestätigt", detail: scoreOf(p), tone: "success" };
    case "CORRECTED":
      return {
        ...base,
        label: "Korrigiert",
        detail: scoreOf(obj((p.after as Prisma.JsonValue) ?? null)),
        tone: "warning",
      };
    case "VOIDED":
      return { ...base, label: "Resultat annulliert", detail: null, tone: "danger" };
    case "ABORTED":
      return { ...base, label: "Abgebrochen", detail: null, tone: "danger" };
    case "FORFEITED": {
      const w = ctx.teamName(str(p.winnerTeamId));
      return { ...base, label: "Forfait", detail: w ? `Sieg für ${w}` : null, tone: "danger" };
    }
    case "ADVANCED": {
      const team = ctx.teamName(str(p.teamId));
      const toCode = str(p.toCode);
      const fromCode = str(p.fromCode);
      if (e.matchId === ctx.matchId) {
        // A team moved INTO this match.
        return {
          ...base,
          label: `${team ?? "Team"} zieht ein`,
          detail: fromCode ? `als Sieger ${codeLabel(fromCode)}` : null,
          tone: "neutral",
        };
      }
      return {
        ...base,
        label: `Weiter in ${codeLabel(toCode) ?? "die nächste Runde"}`,
        detail: team,
        tone: "gold",
      };
    }
    case "CHAMPION": {
      const team = ctx.teamName(str(p.teamId));
      return { ...base, label: `Champion ${team ?? ""}`.trim(), detail: "PharmaPong-Sieger", tone: "gold" };
    }
    case "ISSUE_REPORTED":
      if (!ctx.includeIssues) return null;
      return { ...base, label: "Problem gemeldet", detail: str(p.text), tone: "danger" };
    case "ISSUE_RESOLVED":
      if (!ctx.includeIssues) return null;
      return { ...base, label: "Problem gelöst", detail: str(p.note), tone: "success" };
    default:
      return null;
  }
}

export async function getMatchDetail(
  matchId: string,
  opts: { includeIssues?: boolean; client?: Db } = {},
): Promise<MatchDetail | null> {
  const client = opts.client ?? db;
  if (!matchId || matchId.length > 64) return null;
  const m = await client.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      code: true,
      stage: true,
      round: true,
      status: true,
      homeSource: true,
      awaySource: true,
      startedAt: true,
      pausedAt: true,
      pausedDurationMs: true,
      endedAt: true,
      confirmedAt: true,
      winnerTeamId: true,
      homeCupsRemaining: true,
      awayCupsRemaining: true,
      endType: true,
      group: { select: { name: true } },
      table: { select: { number: true } },
      nextMatch: { select: { code: true } },
      homeTeam: { select: teamSelect },
      awayTeam: { select: teamSelect },
      tournament: {
        select: { matchDurationSec: true, publicDisplayEnabled: true, championTeamId: true },
      },
    },
  });
  if (!m) return null;

  const [own, outgoing] = await Promise.all([
    client.matchEvent.findMany({
      where: { matchId: m.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, payload: true, createdAt: true, matchId: true },
    }),
    // Advancement events are stored on the next match; show them here too.
    client.matchEvent.findMany({
      where: {
        tournamentId: m.tournamentId,
        type: "ADVANCED",
        matchId: { not: m.id },
        payload: { path: ["fromCode"], equals: m.code },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, payload: true, createdAt: true, matchId: true },
    }),
  ]);

  const home = toTeam(m.homeTeam);
  const away = toTeam(m.awayTeam);
  const names = new Map<string, string>();
  for (const t of [home, away]) if (t) names.set(t.id, t.name);
  const ctx = {
    matchId: m.id,
    teamName: (id: string | null) => (id ? (names.get(id) ?? null) : null),
    includeIssues: !!opts.includeIssues,
  };
  const timeline = [...own, ...outgoing]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((e) => timelineEntry(e, ctx))
    .filter((e): e is MatchTimelineEntry => e !== null);

  const decided = m.status === "COMPLETED" || m.status === "FORFEITED";
  const group = m.group?.name ?? null;
  return {
    id: m.id,
    tournamentId: m.tournamentId,
    code: m.code,
    label: matchLabel(m.code, m.stage, m.round, group),
    stage: m.stage,
    round: m.round,
    group,
    status: m.status,
    tableNumber: m.table?.number ?? null,
    home,
    away,
    homeSourceLabel: home ? null : sourceLabel(m.homeSource),
    awaySourceLabel: away ? null : sourceLabel(m.awaySource),
    nextCode: m.nextMatch?.code ?? null,
    nextLabel: codeLabel(m.nextMatch?.code ?? null),
    result:
      decided && m.winnerTeamId && m.homeCupsRemaining != null && m.awayCupsRemaining != null && m.endType
        ? {
            winnerTeamId: m.winnerTeamId,
            homeCupsRemaining: m.homeCupsRemaining,
            awayCupsRemaining: m.awayCupsRemaining,
            endType: m.endType,
          }
        : null,
    timer: m.startedAt
      ? {
          startedAt: ms(m.startedAt),
          pausedAt: ms(m.pausedAt),
          endedAt: ms(m.endedAt),
          pausedDurationMs: m.pausedDurationMs,
          durationSec: m.tournament.matchDurationSec,
        }
      : null,
    startedAt: ms(m.startedAt),
    endedAt: ms(m.endedAt),
    confirmedAt: ms(m.confirmedAt),
    publicDisplayEnabled: m.tournament.publicDisplayEnabled,
    championTeamId: m.tournament.championTeamId,
    timeline,
  };
}
