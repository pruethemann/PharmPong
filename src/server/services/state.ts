// Loads a tournament's full state and maps it onto the pure domain types.
// Used by tournament/match services (inside transactions) and the live snapshot.
import type { Db, Tx } from "@/server/db";
import { computeGroupStandings, computeQualifiers } from "@/server/domain/standings";
import type {
  GroupName,
  GroupStandings,
  MatchResult,
  MatchView,
  Qualifiers,
  TableView,
  TiebreakRecord,
} from "@/server/domain/types";
import { DECIDED_MATCH_STATUSES } from "@/server/domain/types";
import type { Match, Tournament } from "@/generated/prisma/client";

export type LoadedMatch = MatchView & { row: Match };

export type TournamentState = {
  tournament: Tournament;
  groups: { id: string; name: GroupName; teamIds: string[] }[];
  matches: LoadedMatch[];
  tables: (TableView & { name: string })[];
  tiebreaks: Map<GroupName, TiebreakRecord[]>;
  standings: GroupStandings[];
  qualifiers: Qualifiers | null;
};

export function toMatchView(m: Match, codeById: Map<string, string>, groupNameById: Map<string, string>): LoadedMatch {
  const decided = DECIDED_MATCH_STATUSES.includes(m.status);
  const result: MatchResult | null =
    decided && m.winnerTeamId && m.homeCupsRemaining != null && m.awayCupsRemaining != null && m.endType
      ? {
          winnerTeamId: m.winnerTeamId,
          homeCupsRemaining: m.homeCupsRemaining,
          awayCupsRemaining: m.awayCupsRemaining,
          endType: m.endType,
        }
      : null;
  return {
    id: m.id,
    code: m.code,
    stage: m.stage,
    round: m.round,
    orderIndex: m.orderIndex,
    group: m.groupId ? ((groupNameById.get(m.groupId) as GroupName | undefined) ?? null) : null,
    status: m.status,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeSource: m.homeSource,
    awaySource: m.awaySource,
    nextCode: m.nextMatchId ? (codeById.get(m.nextMatchId) ?? null) : null,
    nextSlot: m.nextSlot,
    tableId: m.tableId,
    endedAt: m.endedAt ? m.endedAt.getTime() : null,
    result,
    row: m,
  };
}

export async function loadTournamentState(client: Db | Tx, tournamentId: string): Promise<TournamentState> {
  const [tournament, groups, matches, tables] = await Promise.all([
    client.tournament.findUniqueOrThrow({ where: { id: tournamentId } }),
    client.group.findMany({
      where: { tournamentId },
      orderBy: { name: "asc" },
      include: {
        assignments: { orderBy: { position: "asc" } },
        tiebreaks: { where: { voidedAt: null } },
      },
    }),
    client.match.findMany({ where: { tournamentId }, orderBy: { orderIndex: "asc" } }),
    client.gameTable.findMany({ where: { tournamentId }, orderBy: { number: "asc" } }),
  ]);
  const codeById = new Map(matches.map((m) => [m.id, m.code]));
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const views = matches.map((m) => toMatchView(m, codeById, groupNameById));

  const tiebreaks = new Map<GroupName, TiebreakRecord[]>();
  const standings: GroupStandings[] = [];
  for (const g of groups) {
    const name = g.name as GroupName;
    const records = g.tiebreaks.map((t) => ({
      teamIds: t.teamIds,
      orderedTeamIds: t.orderedTeamIds,
      basisHash: t.basisHash,
    }));
    tiebreaks.set(name, records);
    standings.push(
      computeGroupStandings(
        name,
        g.assignments.map((a) => a.teamId),
        views.filter((v) => v.stage === "GROUP" && v.group === name),
        records,
      ),
    );
  }
  const qualifiers = standings.length === 4 ? computeQualifiers(standings) : null;

  return {
    tournament,
    groups: groups.map((g) => ({ id: g.id, name: g.name as GroupName, teamIds: g.assignments.map((a) => a.teamId) })),
    matches: views,
    tables: tables.map((t) => ({ id: t.id, number: t.number, name: t.name, isDisabled: t.isDisabled })),
    tiebreaks,
    standings,
    qualifiers,
  };
}

/** Lock specific match rows (in orderIndex order to avoid deadlocks) inside a tournament tx. */
export async function lockMatches(tx: Tx, matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ANY(${matchIds}::text[]) ORDER BY "orderIndex" FOR UPDATE`;
}
