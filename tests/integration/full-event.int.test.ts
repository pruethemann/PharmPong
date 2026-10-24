// Spec §18 full simulation: 24 participants, 12 teams, all 19 matches through the
// real services, then an independent verification of the database.
//
// tests/integration/setup.ts truncates all tables before every test, so the
// simulation and its verification run inside one test (split into checks).
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { computeGroupStandings, computeQualifiers } from "@/server/domain/standings";
import { GROUP_NAMES, type GroupName, type GroupStandings } from "@/server/domain/types";
import { ensureTournament } from "@/server/services/bootstrap";
import { buildPublicSnapshot, clearLiveSnapshotCache } from "@/server/services/live-snapshot";
import { toMatchView } from "@/server/services/state";
import {
  BLOCKED_QF3,
  KNOCKOUT_PLAN,
  simulateTournament,
  type SimulationReport,
} from "@/server/sim/simulate-tournament";
import type { Match } from "@/generated/prisma/client";

// Expected group tables by draw position (see GROUP_PLAN in simulate-tournament.ts).
type Expected = { points: number; cupsFor: number; cupsAgainst: number; rank: number; decidedBy: string };
const EXPECTED: Record<GroupName, Expected[]> = {
  A: [
    { points: 3, cupsFor: 16, cupsAgainst: 16, rank: 1, decidedBy: "SHOOTOUT" },
    { points: 3, cupsFor: 16, cupsAgainst: 16, rank: 2, decidedBy: "SHOOTOUT" },
    { points: 3, cupsFor: 16, cupsAgainst: 16, rank: 3, decidedBy: "SHOOTOUT" },
  ],
  B: [
    { points: 6, cupsFor: 17, cupsAgainst: 12, rank: 1, decidedBy: "POINTS" },
    { points: 3, cupsFor: 17, cupsAgainst: 15, rank: 2, decidedBy: "POINTS" },
    { points: 0, cupsFor: 13, cupsAgainst: 20, rank: 3, decidedBy: "POINTS" },
  ],
  C: [
    { points: 6, cupsFor: 18, cupsAgainst: 9, rank: 1, decidedBy: "POINTS" },
    { points: 3, cupsFor: 15, cupsAgainst: 15, rank: 2, decidedBy: "POINTS" },
    { points: 0, cupsFor: 11, cupsAgainst: 20, rank: 3, decidedBy: "POINTS" },
  ],
  D: [
    { points: 6, cupsFor: 20, cupsAgainst: 11, rank: 1, decidedBy: "POINTS" },
    { points: 3, cupsFor: 13, cupsAgainst: 19, rank: 2, decidedBy: "POINTS" },
    { points: 0, cupsFor: 17, cupsAgainst: 20, rank: 3, decidedBy: "POINTS" },
  ],
};

type Db = {
  tournamentId: string;
  revisionBefore: number;
  report: SimulationReport;
  matches: Match[];
  byCode: Map<string, Match>;
  positions: Record<GroupName, string[]>;
  standings: GroupStandings[];
};

async function loadDb(tournamentId: string, revisionBefore: number, report: SimulationReport): Promise<Db> {
  const matches = await db.match.findMany({ where: { tournamentId }, orderBy: { orderIndex: "asc" } });
  const groups = await db.group.findMany({
    where: { tournamentId },
    orderBy: { name: "asc" },
    include: { assignments: { orderBy: { position: "asc" } }, tiebreaks: { where: { voidedAt: null } } },
  });
  const codeById = new Map(matches.map((m) => [m.id, m.code]));
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const views = matches.map((m) => toMatchView(m, codeById, groupNameById));
  const positions = Object.fromEntries(
    groups.map((g) => [g.name, g.assignments.map((a) => a.teamId)]),
  ) as Record<GroupName, string[]>;
  // Recompute the standings from the raw rows (independent of the services' cached state).
  const standings = groups.map((g) =>
    computeGroupStandings(
      g.name as GroupName,
      positions[g.name as GroupName],
      views.filter((v) => v.stage === "GROUP" && v.group === g.name),
      g.tiebreaks.map((t) => ({
        teamIds: t.teamIds,
        orderedTeamIds: t.orderedTeamIds,
        basisHash: t.basisHash,
      })),
    ),
  );
  return {
    tournamentId,
    revisionBefore,
    report,
    matches,
    byCode: new Map(matches.map((m) => [m.code, m])),
    positions,
    standings,
  };
}

function checkMatches(d: Db) {
  expect(d.matches).toHaveLength(19);
  for (const m of d.matches) {
    expect(["COMPLETED", "FORFEITED"], m.code).toContain(m.status);
    expect(m.winnerTeamId, m.code).not.toBeNull();
    expect([m.homeTeamId, m.awayTeamId], m.code).toContain(m.winnerTeamId);
    expect(m.startedAt, m.code).not.toBeNull();
    expect(m.endedAt, m.code).not.toBeNull();
    expect(m.confirmedAt, m.code).not.toBeNull();
    expect(m.tableId, `${m.code} keeps its table for history`).not.toBeNull();
  }
  expect(d.matches.filter((m) => m.endType === "SHOOTOUT").length).toBeGreaterThanOrEqual(1);
  expect(d.matches.filter((m) => m.endType === "TIME_LIMIT").length).toBeGreaterThanOrEqual(1);
}

async function checkTournament(d: Db) {
  const t = await db.tournament.findUniqueOrThrow({ where: { id: d.tournamentId } });
  expect(t.status).toBe("COMPLETED");
  expect(t.isPaused).toBe(false);
  expect(t.championTeamId).toBe(d.byCode.get("F")!.winnerTeamId);
  expect(t.championTeamId).toBe(d.report.championTeamId);
  expect(t.revision).toBeGreaterThan(d.revisionBefore);
  expect(d.report.revisionAfter).toBe(t.revision);
  // QF1 was corrected to the away team (B2), who then wins SF1 (home) and the final (home).
  expect(t.championTeamId).toBe(d.positions.B[1]);
}

function checkStandings(d: Db) {
  for (const g of GROUP_NAMES) {
    const s = d.standings.find((x) => x.group === g)!;
    expect(s.complete, g).toBe(true);
    expect(s.unresolved, g).toEqual([]);
    const expected = EXPECTED[g];
    expect(
      s.rows.map((r) => r.teamId),
      g,
    ).toEqual(d.positions[g]);
    s.rows.forEach((row, i) => {
      expect(
        {
          played: row.played,
          points: row.points,
          cupsFor: row.cupsFor,
          cupsAgainst: row.cupsAgainst,
          cupDiff: row.cupDiff,
          rank: row.rank,
          provisional: row.provisional,
        },
        `${g}${i + 1}`,
      ).toEqual({
        played: 2,
        points: expected[i].points,
        cupsFor: expected[i].cupsFor,
        cupsAgainst: expected[i].cupsAgainst,
        cupDiff: expected[i].cupsFor - expected[i].cupsAgainst,
        rank: expected[i].rank,
        provisional: false,
      });
    });
  }
  const a = d.standings.find((x) => x.group === "A")!;
  expect(a.rows.every((r) => r.decidedBy === "SHOOTOUT")).toBe(true);
}

async function checkTiebreak(d: Db) {
  const a = await db.group.findFirstOrThrow({
    where: { tournamentId: d.tournamentId, name: "A" },
    include: { tiebreaks: true },
  });
  expect(a.tiebreaks).toHaveLength(1);
  expect(a.tiebreaks[0].voidedAt).toBeNull();
  expect(a.tiebreaks[0].orderedTeamIds).toEqual(d.positions.A);
  expect([...a.tiebreaks[0].teamIds].sort()).toEqual([...d.positions.A].sort());
  const others = await db.groupTiebreak.count({
    where: { group: { tournamentId: d.tournamentId, name: { not: "A" } } },
  });
  expect(others).toBe(0);
}

function checkBracket(d: Db) {
  const q = computeQualifiers(d.standings)!;
  expect(q).not.toBeNull();
  const qf = (code: string, home: keyof typeof q, away: keyof typeof q) => {
    const m = d.byCode.get(code)!;
    expect([m.homeTeamId, m.awayTeamId], code).toEqual([q[home], q[away]]);
  };
  qf("QF1", "A1", "B2");
  qf("QF2", "B1", "A2");
  qf("QF3", "C1", "D2");
  qf("QF4", "D1", "C2");
  // Qualifiers by draw position: p1 = 1st, p2 = 2nd in every group (A via the shootout).
  for (const g of GROUP_NAMES) {
    expect(q[`${g}1` as keyof typeof q]).toBe(d.positions[g][0]);
    expect(q[`${g}2` as keyof typeof q]).toBe(d.positions[g][1]);
  }
  // Every SF/F slot holds the winner of its feeder (nextMatchId + nextSlot).
  for (const m of d.matches.filter((x) => x.nextMatchId)) {
    const next = d.matches.find((x) => x.id === m.nextMatchId)!;
    const slot = m.nextSlot === "HOME" ? next.homeTeamId : next.awayTeamId;
    expect(slot, `${m.code} → ${next.code}`).toBe(m.winnerTeamId);
  }
  for (const code of ["SF1", "SF2", "F"]) {
    expect(
      d.matches.filter((m) => m.nextMatchId === d.byCode.get(code)!.id),
      code,
    ).toHaveLength(2);
  }
  // (d) QF1 corrected: the away team won in the end, SF1 home was re-seeded to it.
  const qf1 = d.byCode.get("QF1")!;
  expect(KNOCKOUT_PLAN.QF1.winner).toBe("HOME");
  expect(qf1.winnerTeamId).toBe(qf1.awayTeamId);
  expect(qf1.resultRevision).toBe(2);
  expect(d.byCode.get("SF1")!.homeTeamId).toBe(qf1.awayTeamId);
  // (e) the blocked QF3 correction left QF3 untouched.
  const qf3 = d.byCode.get("QF3")!;
  expect(BLOCKED_QF3.winner).toBe("AWAY");
  expect(qf3.winnerTeamId).toBe(qf3.homeTeamId);
  expect(qf3.resultRevision).toBe(1);
}

async function checkLocksAndAudit(d: Db) {
  expect(await db.activeTeamMatch.count()).toBe(0);
  const audit = await db.auditLog.findMany({
    where: { tournamentId: d.tournamentId },
    select: { action: true, entityId: true, reason: true, before: true, after: true },
  });
  const confirmed = new Set(audit.filter((a) => a.action === "match.confirm").map((a) => a.entityId));
  for (const m of d.matches) expect(confirmed.has(m.id), `match.confirm for ${m.code}`).toBe(true);
  // Exactly one confirm per match: the idempotent replay did not write a second audit row.
  expect(audit.filter((a) => a.action === "match.confirm")).toHaveLength(19);
  expect(audit.filter((a) => a.action === "match.propose")).toHaveLength(19);

  const corrections = audit.filter((a) => a.action === "match.correct");
  expect(corrections).toHaveLength(1);
  expect(corrections[0].entityId).toBe(d.byCode.get("QF1")!.id);
  expect(corrections[0].reason).toBeTruthy();
  expect(corrections[0].before).toMatchObject({ winnerTeamId: d.byCode.get("QF1")!.homeTeamId });
  expect(corrections[0].after).toMatchObject({ winnerTeamId: d.byCode.get("QF1")!.awayTeamId });
  const reseeds = audit.filter((a) => a.action === "match.reseed");
  expect(reseeds.map((a) => a.entityId)).toEqual([d.byCode.get("SF1")!.id]);

  for (const action of [
    "tournament.draw",
    "tournament.start_group_stage",
    "tiebreak.record",
    "tournament.start_knockout",
    "tournament.complete",
  ]) {
    expect(
      audit.filter((a) => a.action === action),
      action,
    ).toHaveLength(1);
  }

  const events = await db.matchEvent.findMany({ where: { tournamentId: d.tournamentId } });
  const count = (type: string) => events.filter((e) => e.type === type).length;
  expect(count("ASSIGNED")).toBe(19);
  expect(count("STARTED")).toBe(19);
  expect(count("PROPOSED")).toBe(19);
  expect(count("CONFIRMED")).toBe(19);
  expect(count("CORRECTED")).toBe(1);
  expect(count("CHAMPION")).toBe(1);
  // 8 quarterfinal seeds + 6 confirmed advancements + 1 re-seed of SF1 home.
  expect(count("ADVANCED")).toBe(15);
}

async function checkConcurrency(d: Db) {
  // Two matches overlapped in time on different tables.
  const runs = d.matches.map((m) => ({ code: m.code, table: m.tableId, from: m.startedAt!, to: m.endedAt! }));
  const overlapping = runs.some((a) =>
    runs.some((b) => a !== b && a.table !== b.table && a.from < b.to && b.from < a.to),
  );
  expect(overlapping).toBe(true);
  const tables = new Set(d.matches.map((m) => m.tableId));
  expect(tables.size).toBe(2);
}

async function checkPublicSnapshot(d: Db) {
  clearLiveSnapshotCache();
  const snap = await buildPublicSnapshot(d.tournamentId);
  expect(snap.tournament.status).toBe("COMPLETED");
  expect(snap.tournament.championTeamId).toBe(d.report.championTeamId);
  expect(snap.matches.every((m) => m.result !== null)).toBe(true);
  expect(snap.recentEvents.some((e) => e.type === "CHAMPION" && e.teamId === d.report.championTeamId)).toBe(
    true,
  );
}

describe("full event simulation (spec §18)", () => {
  it("plays 19 matches with a tied group, shootouts, a correction, concurrent tables and a champion", async () => {
    clearLiveSnapshotCache();
    const tournamentId = await ensureTournament(db);
    const revisionBefore = (await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).revision;
    const log: string[] = [];
    const report = await simulateTournament({
      seed: 7,
      tournamentId,
      demoPassword: "simulation-pass-123",
      log: (m) => log.push(m),
    });

    expect(report.matchesPlayed).toBe(19);
    expect(report.maxConcurrentInProgress).toBe(2);
    const kinds = report.events.map((e) => e.kind);
    for (const k of [
      "UNRESOLVED_TIE_BLOCKED",
      "RANKING_SHOOTOUT",
      "SHOOTOUT_RESULT",
      "TIME_LIMIT_RESULT",
      "CONCURRENT_MATCHES",
      "IDEMPOTENT_REPLAY",
      "CORRECTION",
      "CORRECTION_BLOCKED",
      "CHAMPION",
    ] as const) {
      expect(kinds, k).toContain(k);
    }
    expect(report.events.find((e) => e.kind === "CORRECTION")?.code).toBe("QF1");
    expect(report.events.find((e) => e.kind === "CORRECTION_BLOCKED")?.code).toBe("QF3");
    expect(log.length).toBeGreaterThan(0);

    const d = await loadDb(tournamentId, revisionBefore, report);
    checkMatches(d);
    await checkTournament(d);
    checkStandings(d);
    await checkTiebreak(d);
    checkBracket(d);
    await checkLocksAndAudit(d);
    await checkConcurrency(d);
    await checkPublicSnapshot(d);
  }, 120_000);
});
