// Export of an Elo session (spec §9.2): final or current standings, all matches with rosters and
// results, the rating changes of the active calculation run and the run history. JSON plus two
// CSV files (same CSV conventions as the tournament export). Admin only; no e-mail addresses.
import { db, type Db } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor, SessionUser } from "@/server/auth/sessions";
import { fail, isDomainError } from "@/server/domain/errors";
import { rankPlayers } from "@/server/domain/elo/ranking";
import { currentEloSession } from "./elo-core";
import { activeRun, paramsOfRun } from "./elo-ratings";
import { exportTimestamp, formatZurich, toCsv } from "./export";
import { getCurrentTournamentId } from "./tx";

export type EloExport = {
  sessionId: string;
  json: {
    format: "pharmapong-elo-export";
    version: 1;
    exportedAt: string;
    tournament: { id: string; name: string };
    session: Record<string, unknown>;
    rankings: Record<string, unknown>[];
    matches: Record<string, unknown>[];
    ratingChanges: Record<string, unknown>[];
    runs: Record<string, unknown>[];
  };
  csv: { rankings: string; matches: string };
};

export async function exportEloSession(
  actor: Actor,
  opts: { sessionId?: string; tournamentId?: string; client?: Db } = {},
): Promise<EloExport> {
  assertRole(actor, "ADMIN");
  const client = opts.client ?? db;
  const tournamentId = opts.tournamentId ?? (await getCurrentTournamentId(client));
  const session = opts.sessionId
    ? await client.eloSession.findUnique({ where: { id: opts.sessionId } })
    : tournamentId
      ? await currentEloSession(client, tournamentId)
      : null;
  if (!session) fail("NOT_FOUND", "Keine Elo-Runde gefunden.");
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: session.tournamentId },
      select: { id: true, name: true },
    });
    const run = await activeRun(tx, session.id);
    const [ratings, matches, changes, runs] = await Promise.all([
      tx.eloPlayerRating.findMany({
        where: { sessionId: session.id },
        include: { user: { select: { displayName: true } } },
      }),
      tx.eloMatch.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          table: { select: { number: true } },
          participants: {
            orderBy: [{ side: "asc" }, { position: "asc" }],
            include: { user: { select: { displayName: true } } },
          },
        },
      }),
      tx.eloRatingChange.findMany({
        where: { runId: run.id },
        orderBy: [{ sequence: "asc" }, { side: "asc" }, { userId: "asc" }],
      }),
      tx.eloRatingRun.findMany({ where: { sessionId: session.id }, orderBy: { revision: "asc" } }),
    ]);
    const nameOf = new Map(ratings.map((r) => [r.userId, r.user.displayName]));
    for (const m of matches) for (const p of m.participants) nameOf.set(p.userId, p.user.displayName);
    const ranked = rankPlayers(ratings, {
      minGamesForChampion: session.minGamesForChampion,
      initialRating: run.initialRating,
      tieKey: (id) => nameOf.get(id) ?? id,
    });
    const rankings = ranked.map((r) => ({
      rank: r.rank,
      userId: r.userId,
      displayName: nameOf.get(r.userId) ?? "?",
      rating: r.rating,
      ratingRounded: Math.round(r.rating),
      ratingChange: r.ratingChange,
      gamesPlayed: r.gamesPlayed,
      wins: r.wins,
      losses: r.losses,
      provisional: r.provisional,
      champion: session.championUserIds.includes(r.userId),
    }));
    const side = (m: (typeof matches)[number], s: "A" | "B") => m.participants.filter((p) => p.side === s);
    const matchRows = matches.map((m) => ({
      id: m.id,
      status: m.status,
      rated: m.rated,
      table: m.table.number,
      sideA: side(m, "A").map((p) => p.user.displayName),
      sideB: side(m, "B").map((p) => p.user.displayName),
      winnerSide: m.winnerSide,
      endType: m.endType,
      cupsRemainingA: m.cupsRemainingA,
      cupsRemainingB: m.cupsRemainingB,
      sequence: m.confirmedSequence,
      ratingMultiplier: m.ratingMultiplier,
      expectedScoreA: m.expectedScoreA,
      startedAt: formatZurich(m.startedAt),
      endedAt: formatZurich(m.endedAt),
      durationMin:
        m.startedAt && m.endedAt
          ? Math.round((m.endedAt.getTime() - m.startedAt.getTime() - m.pausedDurationMs) / 600) / 100
          : null,
      confirmedAt: formatZurich(m.confirmedAt),
      cancelReason: m.cancelReason,
      disputeNote: m.disputeNote,
    }));
    const json: EloExport["json"] = {
      format: "pharmapong-elo-export",
      version: 1,
      exportedAt: now.toISOString(),
      tournament,
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        settings: {
          minTeamSize: session.minTeamSize,
          maxTeamSize: session.maxTeamSize,
          minGamesForChampion: session.minGamesForChampion,
          softReminderMinutes: session.softReminderMinutes,
          resultPolicy: session.resultPolicy,
        },
        params: { ...paramsOfRun(run), algorithmVersion: run.algorithmVersion, runRevision: run.revision },
        champions: session.championUserIds.map((id) => nameOf.get(id) ?? id),
      },
      rankings,
      matches: matchRows,
      ratingChanges: changes.map((c) => ({
        sequence: c.sequence,
        matchId: c.matchId,
        userId: c.userId,
        displayName: nameOf.get(c.userId) ?? "?",
        side: c.side,
        ratingBefore: c.ratingBefore,
        delta: c.delta,
        ratingAfter: c.ratingAfter,
        expectedScore: c.expectedScore,
        teamSize: c.teamSize,
        opponentTeamSize: c.opponentTeamSize,
        multiplier: c.multiplier,
        algorithmVersion: c.algorithmVersion,
      })),
      runs: runs.map((r) => ({
        revision: r.revision,
        reason: r.reason,
        note: r.note,
        kFactor: r.kFactor,
        ratingScale: r.ratingScale,
        initialRating: r.initialRating,
        repeatMultipliers: r.repeatMultipliers,
        algorithmVersion: r.algorithmVersion,
        runtime: r.runtime,
        createdAt: r.createdAt.toISOString(),
        supersededAt: r.supersededAt?.toISOString() ?? null,
      })),
    };
    const csv = {
      rankings: toCsv(
        [
          "Rang",
          "Name",
          "Elo",
          "Elo (gerundet)",
          "Veränderung",
          "Spiele",
          "Siege",
          "Niederlagen",
          "Provisorisch",
          "Champion",
        ],
        rankings.map((r) => [
          r.rank,
          r.displayName,
          r.rating,
          r.ratingRounded,
          r.ratingChange,
          r.gamesPlayed,
          r.wins,
          r.losses,
          r.provisional,
          r.champion,
        ]),
      ),
      matches: toCsv(
        [
          "Nr.",
          "Status",
          "Gewertet",
          "Tisch",
          "Team A",
          "Team B",
          "Sieger",
          "Ende",
          "Becher A",
          "Becher B",
          "Faktor",
          "Start",
          "Dauer (min)",
          "Bestätigt",
        ],
        matchRows.map((m) => [
          m.sequence,
          m.status,
          m.rated,
          m.table,
          m.sideA.join(", "),
          m.sideB.join(", "),
          m.winnerSide,
          m.endType,
          m.cupsRemainingA,
          m.cupsRemainingB,
          m.ratingMultiplier,
          m.startedAt,
          m.durationMin,
          m.confirmedAt,
        ]),
      ),
    };
    return { sessionId: session.id, json, csv };
  });
}

export const ELO_EXPORT_FORMATS = ["json", "rankings.csv", "matches.csv"] as const;
type EloExportFormat = (typeof ELO_EXPORT_FORMATS)[number];

const NO_STORE = { "Cache-Control": "no-store" } as const;
const jsonError = (error: string, status: number) => Response.json({ error }, { status, headers: NO_STORE });

/** GET /api/admin/elo-export?format=json|rankings.csv|matches.csv[&sessionId=] */
export async function handleEloExportRequest(
  req: Request,
  user: SessionUser | null,
  opts: { client?: Db; now?: Date; tournamentId?: string } = {},
): Promise<Response> {
  if (!user) return jsonError("UNAUTHENTICATED", 401);
  if (user.role !== "ADMIN" || user.mustChangePassword) return jsonError("FORBIDDEN", 403);
  const params = new URL(req.url).searchParams;
  const format = (params.get("format") ?? "json") as EloExportFormat;
  if (!ELO_EXPORT_FORMATS.includes(format)) return jsonError("VALIDATION", 400);
  let data: EloExport;
  try {
    data = await exportEloSession(user, {
      sessionId: params.get("sessionId") || undefined,
      tournamentId: opts.tournamentId,
      client: opts.client,
    });
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") return jsonError("NOT_FOUND", 404);
    throw e;
  }
  const base = `pharmapong-elo-${exportTimestamp(opts.now)}`;
  const [body, type, filename] =
    format === "json"
      ? [JSON.stringify(data.json, null, 2), "application/json; charset=utf-8", `${base}.json`]
      : format === "rankings.csv"
        ? [data.csv.rankings, "text/csv; charset=utf-8", `${base}-rangliste.csv`]
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
