// Admin export of a tournament: JSON (tournament, groups with standings, matches
// with teams/results/timestamps, audit count) and two CSV tables (standings,
// matches). Contains no e-mail addresses, password hashes, invite codes or
// session data. Used by scripts/export-tournament.ts and GET /api/admin/export.
import { db, type Db } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor, SessionUser } from "@/server/auth/sessions";
import { fail, isDomainError } from "@/server/domain/errors";
import type { StandingRow } from "@/server/domain/types";
import { endTypeLabel, matchStatusLabel, tournamentStatusLabel } from "@/lib/i18n/de";
import { loadTournamentState } from "./state";
import { getCurrentTournamentId } from "./tx";

export const EXPORT_TIME_ZONE = "Europe/Zurich";

const zurichFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: EXPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "24.10.2026, 14:03:05" in Europe/Zurich, or null. */
export function formatZurich(d: Date | null | undefined): string | null {
  return d ? zurichFormat.format(d) : null;
}

export type ExportTime = { iso: string; local: string } | null;
const time = (d: Date | null | undefined): ExportTime =>
  d ? { iso: d.toISOString(), local: formatZurich(d)! } : null;

export type ExportTeamRef = { id: string; name: string } | null;

export type ExportJson = {
  format: "pharmapong-export";
  version: 1;
  exportedAt: NonNullable<ExportTime>;
  timeZone: string;
  tournament: {
    id: string;
    name: string;
    status: string;
    statusLabel: string;
    matchDurationSec: number;
    bombRuleEnabled: boolean;
    revision: number;
    champion: ExportTeamRef;
    createdAt: ExportTime;
    drawGeneratedAt: ExportTime;
    rosterLockedAt: ExportTime;
  };
  teams: { id: string; name: string; motto: string | null; group: string | null; members: string[] }[];
  groups: {
    name: string;
    complete: boolean;
    standings: (Omit<StandingRow, "teamId"> & { team: ExportTeamRef })[];
    tiebreaks: {
      teams: ExportTeamRef[];
      recordedAt: ExportTime;
      voidedAt: ExportTime;
      note: string | null;
    }[];
  }[];
  matches: {
    code: string;
    stage: string;
    round: number;
    orderIndex: number;
    group: string | null;
    status: string;
    statusLabel: string;
    homeTeam: ExportTeamRef;
    awayTeam: ExportTeamRef;
    homeSource: string | null;
    awaySource: string | null;
    table: number | null;
    result: {
      winner: ExportTeamRef;
      homeCupsRemaining: number;
      awayCupsRemaining: number;
      endType: string;
      endTypeLabel: string;
      resultRevision: number;
    } | null;
    assignedAt: ExportTime;
    startedAt: ExportTime;
    endedAt: ExportTime;
    confirmedAt: ExportTime;
    pausedDurationMs: number;
    corrections: number;
  }[];
  auditCount: number;
};

export type TournamentExport = {
  tournamentId: string;
  json: ExportJson;
  csv: { standings: string; matches: string };
};

// ─── CSV ───────────────────────────────────────────────────────────────────

/** Semicolon-separated (Swiss Excel default), UTF-8 with BOM, CRLF line ends. */
export const CSV_SEPARATOR = ";";

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Neutralize spreadsheet formulas in free text (CSV injection).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(CSV_SEPARATOR));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ─── Export ────────────────────────────────────────────────────────────────

export async function exportTournament(
  actor: Actor,
  tournamentId?: string,
  client: Db = db,
): Promise<TournamentExport> {
  assertRole(actor, "ADMIN");
  const id = tournamentId ?? (await getCurrentTournamentId(client));
  if (!id) fail("NOT_FOUND", "Kein Turnier gefunden.");
  const exists = await client.tournament.findUnique({ where: { id }, select: { id: true } });
  if (!exists) fail("NOT_FOUND", "Turnier nicht gefunden.");

  // One consistent read (repeatable read, read only).
  const { state, teams, tiebreaks, tables, corrections, auditCount, now } = await client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const state = await loadTournamentState(tx, id);
      const [teams, tiebreaks, tables, corrections, auditCount] = await Promise.all([
        tx.team.findMany({
          where: { tournamentId: id, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            motto: true,
            members: {
              where: { leftAt: null },
              orderBy: { slot: "asc" },
              select: { user: { select: { displayName: true } } },
            },
          },
        }),
        tx.groupTiebreak.findMany({
          where: { group: { tournamentId: id } },
          orderBy: { createdAt: "asc" },
          select: {
            orderedTeamIds: true,
            createdAt: true,
            voidedAt: true,
            note: true,
            group: { select: { name: true } },
          },
        }),
        tx.gameTable.findMany({ where: { tournamentId: id }, select: { id: true, number: true } }),
        tx.matchEvent.groupBy({
          by: ["matchId"],
          where: { tournamentId: id, type: "CORRECTED" },
          _count: { _all: true },
        }),
        tx.auditLog.count({ where: { tournamentId: id } }),
      ]);
      return { state, teams, tiebreaks, tables, corrections, auditCount, now };
    },
    { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 },
  );

  const t = state.tournament;
  const nameById = new Map(teams.map((x) => [x.id, x.name]));
  // Matches may reference teams dissolved later; resolve their names too.
  const missing = [
    ...new Set(
      state.matches
        .flatMap((m) => [m.homeTeamId, m.awayTeamId, m.row.winnerTeamId])
        .concat(t.championTeamId)
        .filter((x): x is string => !!x && !nameById.has(x)),
    ),
  ];
  if (missing.length > 0) {
    const extra = await client.team.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    });
    for (const x of extra) nameById.set(x.id, x.name);
  }
  const ref = (teamId: string | null | undefined): ExportTeamRef =>
    teamId ? { id: teamId, name: nameById.get(teamId) ?? "" } : null;
  const groupOfTeam = new Map(state.groups.flatMap((g) => g.teamIds.map((tid) => [tid, g.name] as const)));
  const tableNumber = new Map(tables.map((x) => [x.id, x.number]));
  const correctionsByMatch = new Map(corrections.map((x) => [x.matchId, x._count._all]));

  const json: ExportJson = {
    format: "pharmapong-export",
    version: 1,
    exportedAt: time(now)!,
    timeZone: EXPORT_TIME_ZONE,
    tournament: {
      id: t.id,
      name: t.name,
      status: t.status,
      statusLabel: tournamentStatusLabel[t.status],
      matchDurationSec: t.matchDurationSec,
      bombRuleEnabled: t.bombRuleEnabled,
      revision: t.revision,
      champion: ref(t.championTeamId),
      createdAt: time(t.createdAt),
      drawGeneratedAt: time(t.drawGeneratedAt),
      rosterLockedAt: time(t.rosterLockedAt),
    },
    teams: teams.map((x) => ({
      id: x.id,
      name: x.name,
      motto: x.motto,
      group: groupOfTeam.get(x.id) ?? null,
      members: x.members.map((m) => m.user.displayName),
    })),
    groups: state.standings.map((s) => ({
      name: s.group,
      complete: s.complete,
      standings: s.rows.map(({ teamId, ...row }) => ({ team: ref(teamId), ...row })),
      tiebreaks: tiebreaks
        .filter((tb) => tb.group.name === s.group)
        .map((tb) => ({
          teams: tb.orderedTeamIds.map(ref),
          recordedAt: time(tb.createdAt),
          voidedAt: time(tb.voidedAt),
          note: tb.note,
        })),
    })),
    matches: state.matches.map((m) => {
      const row = m.row;
      return {
        code: m.code,
        stage: m.stage,
        round: m.round,
        orderIndex: m.orderIndex,
        group: m.group,
        status: m.status,
        statusLabel: matchStatusLabel[m.status],
        homeTeam: ref(m.homeTeamId),
        awayTeam: ref(m.awayTeamId),
        homeSource: m.homeSource,
        awaySource: m.awaySource,
        table: m.tableId ? (tableNumber.get(m.tableId) ?? null) : null,
        result: m.result
          ? {
              winner: ref(m.result.winnerTeamId),
              homeCupsRemaining: m.result.homeCupsRemaining,
              awayCupsRemaining: m.result.awayCupsRemaining,
              endType: m.result.endType,
              endTypeLabel: endTypeLabel[m.result.endType],
              resultRevision: row.resultRevision,
            }
          : null,
        assignedAt: time(row.assignedAt),
        startedAt: time(row.startedAt),
        endedAt: time(row.endedAt),
        confirmedAt: time(row.confirmedAt),
        pausedDurationMs: row.pausedDurationMs,
        corrections: correctionsByMatch.get(m.id) ?? 0,
      };
    }),
    auditCount,
  };

  const standings = toCsv(
    [
      "Gruppe",
      "Rang",
      "Team",
      "Spiele",
      "Siege",
      "Niederlagen",
      "Punkte",
      "Becher erzielt",
      "Becher erhalten",
      "Becherdifferenz",
      "Entschieden durch",
      "Provisorisch",
    ],
    json.groups.flatMap((g) =>
      g.standings.map((s) => [
        g.name,
        s.rank,
        s.team?.name,
        s.played,
        s.wins,
        s.losses,
        s.points,
        s.cupsFor,
        s.cupsAgainst,
        s.cupDiff,
        s.decidedBy,
        s.provisional ? "ja" : "nein",
      ]),
    ),
  );
  const matches = toCsv(
    [
      "Spiel",
      "Phase",
      "Gruppe",
      "Runde",
      "Status",
      "Heim",
      "Gast",
      "Sieger",
      "Becher Heim",
      "Becher Gast",
      "Spielende",
      "Tisch",
      "Gestartet",
      "Beendet",
      "Bestätigt",
      "Pausen (s)",
      "Korrekturen",
    ],
    json.matches.map((m) => [
      m.code,
      m.stage === "GROUP" ? "Gruppe" : "K.-o.",
      m.group,
      m.round,
      m.statusLabel,
      m.homeTeam?.name ?? m.homeSource,
      m.awayTeam?.name ?? m.awaySource,
      m.result?.winner?.name,
      m.result?.homeCupsRemaining,
      m.result?.awayCupsRemaining,
      m.result?.endTypeLabel,
      m.table,
      m.startedAt?.local,
      m.endedAt?.local,
      m.confirmedAt?.local,
      Math.round(m.pausedDurationMs / 1000),
      m.corrections,
    ]),
  );

  return { tournamentId: id, json, csv: { standings, matches } };
}

/** File-name friendly timestamp in Zurich time, e.g. "2026-10-24_14-03-05". */
export function exportTimestamp(d: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: EXPORT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

// ─── HTTP handler (GET /api/admin/export) ─────────────────────────────────

export const EXPORT_FORMATS = ["json", "standings.csv", "matches.csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const NO_STORE = { "Cache-Control": "no-store" } as const;
const jsonError = (error: string, status: number) => Response.json({ error }, { status, headers: NO_STORE });

/**
 * `?format=json|standings.csv|matches.csv` (default json), optional `?tournamentId=`.
 * 401 without a user, 403 for non-admins, 400 for an unknown format, 404 without a tournament.
 */
export async function handleExportRequest(
  req: Request,
  user: Pick<SessionUser, "id" | "email" | "displayName" | "role" | "mustChangePassword"> | null,
  opts: { client?: Db; now?: Date } = {},
): Promise<Response> {
  if (!user) return jsonError("UNAUTHENTICATED", 401);
  if (user.role !== "ADMIN" || user.mustChangePassword) return jsonError("FORBIDDEN", 403);
  const params = new URL(req.url).searchParams;
  const format = (params.get("format") ?? "json") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) return jsonError("VALIDATION", 400);
  const tournamentId = params.get("tournamentId") || undefined;
  let data: TournamentExport;
  try {
    data = await exportTournament(user, tournamentId, opts.client);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") return jsonError("NOT_FOUND", 404);
    throw e;
  }
  const stamp = exportTimestamp(opts.now);
  const base = `pharmapong-export-${stamp}`;
  const [body, type, filename] =
    format === "json"
      ? [JSON.stringify(data.json, null, 2), "application/json; charset=utf-8", `${base}.json`]
      : format === "standings.csv"
        ? [data.csv.standings, "text/csv; charset=utf-8", `${base}-standings.csv`]
        : [data.csv.matches, "text/csv; charset=utf-8", `${base}-matches.csv`];
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
