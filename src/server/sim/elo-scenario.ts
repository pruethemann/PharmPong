// Seeds a realistic Elo Mode evening through the real services (dev scenario, E2E, screenshots):
// the event switches to ELO, about two dozen matches are played and confirmed (all team sizes,
// a friendly, a repeated pairing), one early result is corrected by the admin, and the end state
// has a running match, a draft waiting for consent, a pending result and a dispute.
// Only timestamps are adjusted directly afterwards, so stopwatches and timelines look like an
// evening instead of a few milliseconds. Never used in production code paths.
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { mulberry32 } from "@/server/domain/rng";
import type { Side } from "@/server/domain/elo/types";
import { correctEloMatch } from "@/server/services/elo-corrections";
import { consentEloRoster, createEloMatch, startEloMatch } from "@/server/services/elo-matches";
import { confirmEloResult, disputeEloResult, submitEloResult } from "@/server/services/elo-results";
import { setGameMode } from "@/server/services/game-mode";

export type EloScenarioResult = {
  sessionId: string;
  completed: number;
  live: { running: string; draft: string };
  pending: string;
  disputed: string;
};

type Opts = {
  tournamentId: string;
  admin: Actor;
  /** At least 18 players; players[0] and players[1] get something to do (consent, confirm). */
  players: Actor[];
  seed?: number;
  rounds?: number;
};

const MIN = 60_000;
/** Team sizes per match (A, B): mostly 2 vs 2, every combination from solo to four. */
const SIZES: [number, number][] = [
  [2, 2],
  [1, 1],
  [2, 2],
  [1, 2],
  [3, 3],
  [2, 2],
  [1, 3],
  [2, 3],
  [2, 2],
  [4, 4],
  [1, 4],
  [3, 2],
];

function pick<T>(rng: () => number, items: T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

const version = (matchId: string) =>
  db.eloMatch.findUniqueOrThrow({ where: { id: matchId }, select: { version: true, resultVersion: true } });

async function draft(o: Opts, tableId: string, a: Actor[], b: Actor[], rated = true) {
  return createEloMatch(
    a[0],
    { tableId, sideA: a.map((p) => p.id), sideB: b.map((p) => p.id), rated },
    { tournamentId: o.tournamentId },
  );
}

async function started(o: Opts, tableId: string, a: Actor[], b: Actor[], rated = true) {
  const d = await draft(o, tableId, a, b, rated);
  await consentEloRoster(b[0], { matchId: d.matchId, rosterHash: d.rosterHash });
  await startEloMatch(a[0], { matchId: d.matchId, expectedVersion: (await version(d.matchId)).version });
  return d.matchId;
}

async function submitted(o: Opts, tableId: string, a: Actor[], b: Actor[], winner: Side, rated = true) {
  const matchId = await started(o, tableId, a, b, rated);
  const cups =
    winner === "A" ? { cupsRemainingA: 2, cupsRemainingB: 0 } : { cupsRemainingA: 0, cupsRemainingB: 3 };
  await submitEloResult(a[0], {
    matchId,
    expectedVersion: (await version(matchId)).version,
    winnerSide: winner,
    endType: "REGULAR",
    ...cups,
    idempotencyKey: randomUUID(),
  });
  return matchId;
}

/** Shift a seeded match's story to `start` (+ duration) so clocks and the timeline look real. */
async function backdate(matchId: string, start: number, durationMs: number | null) {
  const end = durationMs == null ? null : start + durationMs;
  const at = (ms: number) => new Date(ms);
  const m = await db.eloMatch.findUniqueOrThrow({ where: { id: matchId } });
  await db.eloMatch.update({
    where: { id: matchId },
    data: {
      createdAt: at(start - 2 * MIN),
      consentAAt: m.consentAAt ? at(start - 2 * MIN) : null,
      consentBAt: m.consentBAt ? at(start - MIN) : null,
      startedAt: m.startedAt ? at(start) : null,
      endedAt: m.endedAt && end ? at(end) : m.endedAt,
      submittedAt: m.submittedAt && end ? at(end) : m.submittedAt,
      confirmedAt: m.confirmedAt && end ? at(end + MIN) : m.confirmedAt,
      disputedAt: m.disputedAt && end ? at(end + 2 * MIN) : m.disputedAt,
    },
  });
  const events: Record<string, number | null> = {
    CREATED: start - 2 * MIN,
    CONSENTED: start - MIN,
    STARTED: start,
    RESULT_SUBMITTED: end,
    RESULT_CONFIRMED: end == null ? null : end + MIN,
    DISPUTED: end == null ? null : end + 2 * MIN,
  };
  for (const [type, ms] of Object.entries(events)) {
    if (ms != null)
      await db.eloMatchEvent.updateMany({ where: { matchId, type }, data: { createdAt: at(ms) } });
  }
  const revisions: Record<string, number | null> = {
    SUBMITTED: end,
    CONFIRMED: end == null ? null : end + MIN,
    DISPUTED: end == null ? null : end + 2 * MIN,
  };
  for (const [kind, ms] of Object.entries(revisions)) {
    if (ms != null)
      await db.eloMatchResultRevision.updateMany({ where: { matchId, kind }, data: { createdAt: at(ms) } });
  }
}

export async function seedEloEvent(o: Opts): Promise<EloScenarioResult> {
  if (o.players.length < 18) throw new Error("seedEloEvent needs at least 18 players");
  const rng = mulberry32(o.seed ?? 11);
  const opts = { tournamentId: o.tournamentId };
  await setGameMode(o.admin, { mode: "ELO" }, opts);
  const session = await db.eloSession.findFirstOrThrow({
    where: { tournamentId: o.tournamentId, status: { not: "CLOSED" } },
  });
  const tables = await db.gameTable.findMany({
    where: { tournamentId: o.tournamentId },
    orderBy: { number: "asc" },
  });

  // Hidden skill decides the winner (logistic), so the ranking has a story.
  const skill = new Map(o.players.map((p) => [p.id, rng() * 2 - 1]));
  const mean = (team: Actor[]) => team.reduce((s, p) => s + skill.get(p.id)!, 0) / team.length;
  const rivalsA = [o.players[2], o.players[3]];
  const rivalsB = [o.players[4], o.players[5]];

  const rounds = o.rounds ?? 24;
  const played: string[] = [];
  const now = Date.now();
  const startOf = (i: number) => now - (rounds - i) * 11 * MIN - 40 * MIN;
  for (let i = 0; i < rounds; i++) {
    const table = tables[i % tables.length];
    let a: Actor[];
    let b: Actor[];
    if (i % 6 === 3) {
      // The same two pairs keep meeting: full, full, half, then unrated (repeat-match rule).
      a = rivalsA;
      b = rivalsB;
    } else {
      const [na, nb] = SIZES[i % SIZES.length];
      const chosen = pick(rng, o.players, na + nb);
      a = chosen.slice(0, na);
      b = chosen.slice(na);
    }
    const pA = 1 / (1 + Math.exp(-3 * (mean(a) - mean(b))));
    const winner: Side = rng() < pA ? "A" : "B";
    const matchId = await submitted(o, table.id, a, b, winner, i !== 7);
    await confirmEloResult(b[0], {
      matchId,
      resultVersion: (await version(matchId)).resultVersion,
      idempotencyKey: randomUUID(),
    });
    await backdate(matchId, startOf(i), (6 + Math.floor(rng() * 10)) * MIN + Math.floor(rng() * 59_000));
    played.push(matchId);
  }

  // The admin corrects an early result: a new calculation run replays everything after it.
  const early = played[1];
  const row = await db.eloMatch.findUniqueOrThrow({ where: { id: early } });
  await correctEloMatch(
    o.admin,
    {
      matchId: early,
      expectedVersion: row.version,
      resultVersion: row.resultVersion,
      changes: { winnerSide: row.winnerSide === "A" ? "B" : "A", cupsRemainingA: null, cupsRemainingB: null },
      reason: "Falsches Team eingetragen (Dev-Szenario)",
      idempotencyKey: randomUUID(),
    },
    opts,
  );

  const p = o.players;
  // A result waiting for players[1] (demo02) to confirm.
  const pending = await submitted(o, tables[0].id, [p[6], p[7]], [p[1], p[8]], "A");
  await backdate(pending, now - 16 * MIN, 9 * MIN + 12_000);
  // A disputed result: the referee has to decide.
  const disputed = await submitted(o, tables[1].id, [p[9]], [p[10], p[11]], "A");
  await disputeEloResult(p[10], {
    matchId: disputed,
    resultVersion: (await version(disputed)).resultVersion,
    note: "Der letzte Becher war nach dem Rand-Wurf noch drin.",
    idempotencyKey: randomUUID(),
  });
  await backdate(disputed, now - 30 * MIN, 12 * MIN + 40_000);
  // Table 1: a running match; table 2: a draft that waits for players[0] (demo01) to agree.
  const running = await started(o, tables[0].id, [p[12], p[13]], [p[14], p[15]]);
  await backdate(running, now - 7 * MIN - 25_000, null);
  const d = await draft(o, tables[1].id, [p[16], p[17]], [p[0]]);
  await backdate(d.matchId, now, null);
  // Dev scenario only: keep the demo draft reserved for an hour instead of 10 minutes.
  await db.eloMatch.update({ where: { id: d.matchId }, data: { expiresAt: new Date(now + 60 * MIN) } });

  return {
    sessionId: session.id,
    completed: played.length,
    live: { running, draft: d.matchId },
    pending,
    disputed,
  };
}
