// Builds a drawn tournament directly in the database (independent of the
// tournament service): 12 teams, groups A–D, 12 group matches READY in
// GROUP_STAGE, 7 knockout matches PENDING with nextMatchId/nextSlot links.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { resolveQuarterfinals } from "@/server/domain/bracket";
import { drawGroups } from "@/server/domain/draw";
import { GROUP_NAMES, type GroupName } from "@/server/domain/types";
import { assignMatch, startMatch } from "@/server/services/matches";
import { confirmResult, proposeResult, type ConfirmOutcome } from "@/server/services/results";
import { loadTournamentState } from "@/server/services/state";
import type { EndType, Match, User } from "@/generated/prisma/client";
import { makeTeam, makeTournament, makeUser } from "./factories";

export const actorOf = (u: User): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? `NO_CODE: ${String(e)}`;
  }
  return "RESOLVED";
}

export const idemKey = () => randomUUID();

export type Fixture = Awaited<ReturnType<typeof buildDrawnTournament>>;

export async function buildDrawnTournament() {
  const t = await makeTournament({ status: "GROUP_STAGE" });
  const tables = await db.gameTable.findMany({ where: { tournamentId: t.id }, orderBy: { number: "asc" } });
  const adminUser = await makeUser({ role: "ADMIN" });
  const refUsers = await Promise.all([0, 1, 2, 3, 4].map(() => makeUser({ role: "REFEREE" })));
  const playerUser = await makeUser({ role: "PLAYER" });
  const teams = [];
  for (let i = 0; i < 12; i++) teams.push(await makeTeam(t.id, [], `Team ${String.fromCharCode(65 + i)}`));
  const draw = drawGroups(
    teams.map((x) => x.id),
    () => 0,
  );

  const groupIds = {} as Record<GroupName, string>;
  for (const name of GROUP_NAMES) {
    const g = await db.group.create({
      data: {
        tournamentId: t.id,
        name,
        assignments: { create: draw.groups[name].map((teamId, i) => ({ teamId, position: i + 1 })) },
      },
    });
    groupIds[name] = g.id;
  }
  const ids: Record<string, string> = {};
  for (const f of draw.fixtures) {
    const m = await db.match.create({
      data: {
        tournamentId: t.id,
        code: f.code,
        stage: f.stage,
        round: f.round,
        orderIndex: f.orderIndex,
        groupId: f.group ? groupIds[f.group] : null,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        homeSource: f.homeSource,
        awaySource: f.awaySource,
        nextSlot: f.nextSlot,
        status: f.stage === "GROUP" ? "READY" : "PENDING",
      },
    });
    ids[f.code] = m.id;
  }
  for (const f of draw.fixtures) {
    if (f.nextCode)
      await db.match.update({ where: { id: ids[f.code] }, data: { nextMatchId: ids[f.nextCode] } });
  }
  const teamName = new Map(teams.map((x) => [x.id, x.name]));
  return {
    t,
    tables,
    groups: draw.groups,
    groupIds,
    ids,
    teamName,
    admin: actorOf(adminUser),
    referee: actorOf(refUsers[0]),
    referees: refUsers.map(actorOf),
    player: actorOf(playerUser),
  };
}

export const getMatch = (fx: Fixture, code: string): Promise<Match> =>
  db.match.findUniqueOrThrow({ where: { id: fx.ids[code] } });

export const getTournament = (fx: Fixture) => db.tournament.findUniqueOrThrow({ where: { id: fx.t.id } });

/**
 * Write confirmed group results directly: in every group the lower draw position
 * wins (REGULAR 5:0), so position 1 → 6 pts, 2 → 3 pts, 3 → 0 pts (no ties).
 */
export async function seedGroupResults(fx: Fixture, opts: { except?: string[] } = {}) {
  const matches = await db.match.findMany({ where: { tournamentId: fx.t.id, stage: "GROUP" } });
  for (const m of matches) {
    if (opts.except?.includes(m.code)) continue;
    const g = m.code[0] as GroupName;
    const pos = (id: string | null) => fx.groups[g].indexOf(id!);
    const homeWins = pos(m.homeTeamId) < pos(m.awayTeamId);
    await db.match.update({
      where: { id: m.id },
      data: {
        status: "COMPLETED",
        winnerTeamId: homeWins ? m.homeTeamId : m.awayTeamId,
        homeCupsRemaining: homeWins ? 5 : 0,
        awayCupsRemaining: homeWins ? 0 : 5,
        endType: "REGULAR",
        confirmedAt: new Date(),
        resultRevision: 1,
        version: { increment: 1 },
      },
    });
  }
}

/** Fill the quarterfinals from the standings and switch to KNOCKOUT_STAGE (direct DB). */
export async function startKnockoutDirect(fx: Fixture) {
  const state = await loadTournamentState(db, fx.t.id);
  if (!state.qualifiers) throw new Error("qualifiers not decided");
  const qf = resolveQuarterfinals(state.qualifiers);
  for (const [code, pair] of Object.entries(qf)) {
    await db.match.update({
      where: { id: fx.ids[code] },
      data: { homeTeamId: pair.home, awayTeamId: pair.away, status: "READY", version: { increment: 1 } },
    });
  }
  await db.tournament.update({ where: { id: fx.t.id }, data: { status: "KNOCKOUT_STAGE" } });
  return state.qualifiers;
}

/** Group results + quarterfinals ready. */
export async function buildKnockoutTournament() {
  const fx = await buildDrawnTournament();
  await seedGroupResults(fx);
  const qualifiers = await startKnockoutDirect(fx);
  return { fx, qualifiers };
}

async function freeTableId(fx: Fixture): Promise<string> {
  const busy = await db.match.findMany({
    where: {
      tournamentId: fx.t.id,
      status: { in: ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] },
    },
    select: { tableId: true },
  });
  const free = fx.tables.find((t) => !busy.some((b) => b.tableId === t.id) && !t.isDisabled);
  if (!free) throw new Error("no free table");
  return free.id;
}

/** Assign (admin) + start (referee). Returns the match row after start. */
export async function assignAndStart(fx: Fixture, code: string, referee = fx.referee): Promise<Match> {
  const m = await getMatch(fx, code);
  const a = await assignMatch(fx.admin, {
    matchId: m.id,
    tableId: await freeTableId(fx),
    expectedVersion: m.version,
  });
  await startMatch(referee, { matchId: m.id, expectedVersion: a.version });
  return getMatch(fx, code);
}

export type SimpleResult = {
  winner: "HOME" | "AWAY";
  winnerCups?: number;
  loserCups?: number;
  endType?: Exclude<EndType, "FORFEIT">;
};

/** Full referee flow through the services: assign → start → propose → confirm. */
export async function playMatch(
  fx: Fixture,
  code: string,
  r: SimpleResult = { winner: "HOME" },
  referee = fx.referee,
): Promise<ConfirmOutcome> {
  const started = await assignAndStart(fx, code, referee);
  const homeWins = r.winner === "HOME";
  const w = r.winnerCups ?? 3;
  const l = r.loserCups ?? 0;
  const p = await proposeResult(referee, {
    matchId: started.id,
    expectedVersion: started.version,
    idempotencyKey: idemKey(),
    winnerTeamId: (homeWins ? started.homeTeamId : started.awayTeamId)!,
    homeCupsRemaining: homeWins ? w : l,
    awayCupsRemaining: homeWins ? l : w,
    endType: r.endType ?? "REGULAR",
  });
  return confirmResult(referee, {
    matchId: started.id,
    expectedVersion: p.version,
    resultRevision: p.resultRevision,
    idempotencyKey: idemKey(),
  });
}

/** DB invariants that must hold after every operation. */
export async function assertInvariants(tournamentId: string) {
  const active = await db.match.findMany({
    where: { tournamentId, status: { in: ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] } },
  });
  const locks = await db.activeTeamMatch.findMany({ where: { tournamentId } });
  const teamCount = new Map<string, number>();
  const tableCount = new Map<string, number>();
  for (const m of active) {
    for (const t of [m.homeTeamId!, m.awayTeamId!]) teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
    tableCount.set(m.tableId!, (tableCount.get(m.tableId!) ?? 0) + 1);
  }
  expect([...teamCount.values()].every((n) => n === 1)).toBe(true);
  expect([...tableCount.values()].every((n) => n === 1)).toBe(true);
  expect(locks).toHaveLength(active.length * 2);
  const expected = active.flatMap((m) => [`${m.homeTeamId}:${m.id}`, `${m.awayTeamId}:${m.id}`]).sort();
  expect(locks.map((l) => `${l.teamId}:${l.matchId}`).sort()).toEqual(expected);
}
