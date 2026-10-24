import { createHash } from "node:crypto";
import { isDecidedStatus } from "./match-state";
import { cupStats } from "./result-rules";
import {
  GROUP_NAMES,
  type GroupName,
  type GroupStandings,
  type MatchView,
  type Qualifiers,
  type StandingRow,
  type TiebreakRecord,
  type UnresolvedTie,
} from "./types";

type DecidedBy = StandingRow["decidedBy"];

/** Index of the first sort criterion that separates two rows (0 = points, 1 = cup diff, 2 = cups for). */
const CRITERIA: ReadonlyArray<Exclude<DecidedBy, null>> = ["POINTS", "CUP_DIFF", "CUPS_FOR"];

function firstDifference(a: StandingRow, b: StandingRow): number {
  if (a.points !== b.points) return 0;
  if (a.cupDiff !== b.cupDiff) return 1;
  // Rows from different buckets always differ on at least one criterion.
  return 2;
}

function compareKey(a: StandingRow, b: StandingRow): number {
  return b.points - a.points || b.cupDiff - a.cupDiff || b.cupsFor - a.cupsFor;
}

const isCounted = (m: MatchView) =>
  isDecidedStatus(m.status) && m.result !== null && m.homeTeamId !== null && m.awayTeamId !== null;

/**
 * Deterministic hash of a tied set and the stats that produced the tie. A
 * later correction that changes any of these stats invalidates a recorded
 * shootout decision.
 */
export function tieBasisHash(teamIds: string[], rows: StandingRow[]): string {
  const parts = [...teamIds].sort().map((id) => {
    const r = rows.find((x) => x.teamId === id);
    return `${id}:${r?.points ?? 0}:${r?.cupDiff ?? 0}:${r?.cupsFor ?? 0}`;
  });
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function headToHeadWinner(matches: MatchView[], a: string, b: string): string | null {
  const m = matches.find(
    (x) =>
      isCounted(x) &&
      ((x.homeTeamId === a && x.awayTeamId === b) || (x.homeTeamId === b && x.awayTeamId === a)),
  );
  const w = m?.result?.winnerTeamId;
  return w === a || w === b ? w : null;
}

function findTiebreak(
  tiebreaks: TiebreakRecord[],
  sortedIds: string[],
  basisHash: string,
): TiebreakRecord | undefined {
  const sameSet = (ids: string[]) =>
    ids.length === sortedIds.length && [...ids].sort().every((id, i) => id === sortedIds[i]);
  return tiebreaks.find((t) => t.basisHash === basisHash && sameSet(t.teamIds) && sameSet(t.orderedTeamIds));
}

/**
 * Group table: points → cup diff → cups for → head-to-head (exactly two tied)
 * → admin-recorded shootout. Never picks an arbitrary order for a tie.
 */
export function computeGroupStandings(
  group: GroupName,
  teamIds: string[],
  matches: MatchView[],
  tiebreaks: TiebreakRecord[],
): GroupStandings {
  const stats = new Map<string, StandingRow>(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        wins: 0,
        losses: 0,
        points: 0,
        cupsFor: 0,
        cupsAgainst: 0,
        cupDiff: 0,
        rank: null,
        provisional: true,
        decidedBy: null,
      },
    ]),
  );

  for (const m of matches) {
    if (!isCounted(m)) continue;
    const result = m.result!;
    for (const [teamId, side] of [
      [m.homeTeamId!, "HOME"],
      [m.awayTeamId!, "AWAY"],
    ] as const) {
      const row = stats.get(teamId);
      if (!row) continue;
      const { cupsFor, cupsAgainst } = cupStats(result, side);
      row.played += 1;
      row.cupsFor += cupsFor;
      row.cupsAgainst += cupsAgainst;
      if (result.winnerTeamId === teamId) {
        row.wins += 1;
        row.points += 3;
      } else {
        row.losses += 1;
      }
    }
  }

  const allDecided = matches.length >= 3 && matches.every((m) => isDecidedStatus(m.status));
  const drawIndex = new Map(teamIds.map((id, i) => [id, i]));
  const sorted = [...stats.values()]
    .map((r) => ({ ...r, cupDiff: r.cupsFor - r.cupsAgainst, provisional: !allDecided }))
    .sort((a, b) => compareKey(a, b) || drawIndex.get(a.teamId)! - drawIndex.get(b.teamId)!);

  // Partition into buckets of identical sort keys.
  const buckets: StandingRow[][] = [];
  for (const row of sorted) {
    const last = buckets.at(-1);
    if (last && compareKey(last[0], row) === 0) last.push(row);
    else buckets.push([row]);
  }

  const rows: StandingRow[] = [];
  const unresolved: UnresolvedTie[] = [];
  buckets.forEach((bucket, bi) => {
    const startRank = rows.length + 1;
    const positions = bucket.map((_, i) => startRank + i);

    if (bucket.length === 1) {
      const [row] = bucket;
      const depths = [buckets[bi - 1]?.[0], buckets[bi + 1]?.[0]]
        .filter((n): n is StandingRow => n !== undefined)
        .map((n) => firstDifference(row, n));
      const depth = depths.length > 0 ? Math.max(...depths) : null;
      rows.push({ ...row, rank: startRank, decidedBy: depth === null ? null : CRITERIA[depth] });
      return;
    }

    if (bucket.length === 2) {
      const winner = headToHeadWinner(matches, bucket[0].teamId, bucket[1].teamId);
      if (winner) {
        const ordered = winner === bucket[0].teamId ? bucket : [bucket[1], bucket[0]];
        ordered.forEach((r, i) => rows.push({ ...r, rank: positions[i], decidedBy: "HEAD_TO_HEAD" }));
        return;
      }
    }

    // Unresolvable by statistics: an admin-recorded shootout decides.
    const ids = bucket.map((r) => r.teamId).sort();
    const basisHash = tieBasisHash(ids, sorted);
    const tb = findTiebreak(tiebreaks, ids, basisHash);
    if (tb) {
      tb.orderedTeamIds.forEach((id, i) => {
        const r = bucket.find((x) => x.teamId === id)!;
        rows.push({ ...r, rank: positions[i], decidedBy: "SHOOTOUT" });
      });
      return;
    }
    bucket.forEach((r) => rows.push({ ...r, rank: null, decidedBy: null }));
    if (allDecided) unresolved.push({ group, teamIds: ids, basisHash, positions });
  });

  return { group, rows, complete: allDecided && unresolved.length === 0, unresolved };
}

/** Group winners and runners-up, only once every group is complete. */
export function computeQualifiers(all: GroupStandings[]): Qualifiers | null {
  const q: Partial<Qualifiers> = {};
  for (const g of GROUP_NAMES) {
    const s = all.find((x) => x.group === g);
    if (!s || !s.complete) return null;
    const first = s.rows.find((r) => r.rank === 1);
    const second = s.rows.find((r) => r.rank === 2);
    if (!first || !second) return null;
    q[`${g}1`] = first.teamId;
    q[`${g}2`] = second.teamId;
  }
  return q as Qualifiers;
}
