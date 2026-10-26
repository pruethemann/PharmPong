// Elo Mode event simulation against a real database, driven only through the services
// (Prisma is used for reads and the final checks). Complements the pure Monte Carlo study
// (elo-montecarlo.ts): this one proves the persistence layer under an evening's workload.
//
// Scenario (deterministic for a given seed):
//   - both tables play in rounds: two matches run at the same time, then report and confirm;
//   - team sizes 1–4 (mostly 2 vs 2), changing teams, hidden skill decides the winner;
//   - one pairing keeps meeting (repeat rule 100/100/50/0), some friendlies;
//   - every few rounds a special case: a draft is cancelled, a result is disputed and resolved
//     by the referee, a pending result is voided, a running match is abandoned, and one
//     confirmation is sent twice at the same time (idempotent: rated once);
//   - afterwards an early result is corrected (new calculation run), a manual recalculation
//     must reproduce the same digest, the dry run must find no deviation, no player or table
//     lock may be left, and the round is closed with its champion(s).
// Not imported by the app at runtime (scripts and integration tests only).
import { randomUUID } from "node:crypto";
import { db, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { mulberry32 } from "@/server/domain/rng";
import { ELO_CLOSE_CONFIRM_TEXT, ELO_RECALC_CONFIRM_TEXT } from "@/server/domain/elo/config";
import type { Side } from "@/server/domain/elo/types";
import { correctEloMatch } from "@/server/services/elo-corrections";
import {
  cancelEloMatch,
  consentEloRoster,
  createEloMatch,
  startEloMatch,
  abandonEloMatch,
} from "@/server/services/elo-matches";
import { verifyRatings, type RatingVerification } from "@/server/services/elo-ratings";
import {
  confirmEloResult,
  disputeEloResult,
  staffFinalizeEloResult,
  submitEloResult,
  voidEloResult,
} from "@/server/services/elo-results";
import { closeEloSession, recalculateElo } from "@/server/services/elo-session";
import { setGameMode } from "@/server/services/game-mode";

export type EloEventSimOptions = {
  seed: number;
  tournamentId: string;
  admin: Actor;
  referee: Actor;
  /** At least 12 players. */
  players: Actor[];
  /** Rounds of two parallel matches (default 23, i.e. 46 matches incl. special cases). */
  rounds?: number;
  client?: Db;
  log?: (message: string) => void;
};

export type EloEventSimReport = {
  seed: number;
  tournamentId: string;
  sessionId: string;
  players: number;
  matches: {
    created: number;
    completed: number;
    rated: number;
    friendlies: number;
    repeatsReduced: number;
    cancelled: number;
    voided: number;
    abandoned: number;
    disputesResolved: number;
  };
  teamSizes: Record<string, number>;
  maxConcurrentRunning: number;
  idempotentReplays: number;
  correction: { matchId: string; runRevision: number };
  recalculationDigestUnchanged: boolean;
  runs: number;
  verify: RatingVerification;
  leftoverPlayerLocks: number;
  leftoverLiveMatches: number;
  ratingSum: number;
  expectedRatingSum: number;
  champions: string[];
  top5: { name: string; rating: number; games: number; wins: number }[];
  eligible: number;
};

/** Team sizes of the regular matches, cycled: mostly 2 vs 2, every size from solo to four. */
const SIZES: [number, number][] = [
  [2, 2],
  [1, 1],
  [2, 2],
  [2, 3],
  [1, 2],
  [3, 3],
  [2, 2],
  [1, 3],
  [4, 4],
  [2, 2],
  [3, 2],
  [1, 4],
  [2, 2],
  [4, 3],
  [2, 1],
  [3, 4],
];

type Special = "CANCEL" | "DISPUTE" | "VOID" | "ABANDON" | "DOUBLE_CONFIRM" | "RIVALS" | "FRIENDLY" | null;

/** Which special case a (round, table) slot plays; everything else is a regular rated match. */
function specialOf(round: number, table: number): Special {
  // One-off cases first, then the recurring ones.
  if (table === 1 && round === 4) return "CANCEL";
  if (table === 0 && round === 6) return "DISPUTE";
  if (table === 1 && round === 9) return "VOID";
  if (table === 0 && round === 12) return "ABANDON";
  if (table === 1 && round === 15) return "DOUBLE_CONFIRM";
  if (table === 0 && round % 5 === 2) return "RIVALS";
  if (table === 1 && round % 7 === 3) return "FRIENDLY";
  return null;
}

export async function simulateEloEvent(o: EloEventSimOptions): Promise<EloEventSimReport> {
  const client = o.client ?? db;
  const opts = { tournamentId: o.tournamentId, client };
  const log = o.log ?? (() => {});
  if (o.players.length < 12) throw new Error("simulateEloEvent needs at least 12 players");
  const rng = mulberry32(o.seed);
  const rounds = o.rounds ?? 23;

  await setGameMode(o.admin, { mode: "ELO" }, opts);
  const session = await client.eloSession.findFirstOrThrow({
    where: { tournamentId: o.tournamentId, status: { not: "CLOSED" } },
  });
  const tables = await client.gameTable.findMany({
    where: { tournamentId: o.tournamentId, isDisabled: false },
    orderBy: { number: "asc" },
    take: 2,
  });
  if (tables.length < 2) throw new Error("simulateEloEvent needs two tables");

  const skill = new Map(o.players.map((p) => [p.id, rng() * 2 - 1]));
  const mean = (team: Actor[]) => team.reduce((s, p) => s + skill.get(p.id)!, 0) / team.length;
  const rivals: [Actor[], Actor[]] = [
    [o.players[0], o.players[1]],
    [o.players[2], o.players[3]],
  ];
  const versionOf = async (id: string) =>
    client.eloMatch.findUniqueOrThrow({ where: { id }, select: { version: true, resultVersion: true } });

  const stats = {
    created: 0,
    friendlies: 0,
    cancelled: 0,
    voided: 0,
    abandoned: 0,
    disputesResolved: 0,
    idempotentReplays: 0,
  };
  const teamSizes: Record<string, number> = {};
  const completedIds: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let regular = 0;

  /** Distinct players for one match, never someone already playing in this round. */
  function pickTeams(busy: Set<string>, special: Special): [Actor[], Actor[]] {
    if (special === "RIVALS") return rivals;
    const [na, nb] = SIZES[regular++ % SIZES.length];
    const pool = o.players.filter((p) => !busy.has(p.id));
    const chosen: Actor[] = [];
    while (chosen.length < na + nb) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return [chosen.slice(0, na), chosen.slice(na)];
  }

  type Live = { matchId: string; a: Actor[]; b: Actor[]; special: Special };

  for (let round = 0; round < rounds; round++) {
    const busy = new Set<string>();
    const live: Live[] = [];
    // 1) Both tables: create, consent, start. Two matches run at the same time.
    for (let t = 0; t < 2; t++) {
      const special = specialOf(round, t);
      const [a, b] = pickTeams(busy, special);
      for (const p of [...a, ...b]) busy.add(p.id);
      const rated = special !== "FRIENDLY";
      const created = await createEloMatch(
        a[0],
        { tableId: tables[t].id, sideA: a.map((p) => p.id), sideB: b.map((p) => p.id), rated },
        opts,
      );
      stats.created++;
      if (!rated) stats.friendlies++;
      const key = `${a.length}v${b.length}`;
      teamSizes[key] = (teamSizes[key] ?? 0) + 1;
      if (special === "CANCEL") {
        await cancelEloMatch(a[0], { matchId: created.matchId, reason: "Doch keine Zeit" }, opts);
        stats.cancelled++;
        continue;
      }
      await consentEloRoster(b[0], { matchId: created.matchId, rosterHash: created.rosterHash }, opts);
      await startEloMatch(
        a[0],
        { matchId: created.matchId, expectedVersion: (await versionOf(created.matchId)).version },
        opts,
      );
      running++;
      maxRunning = Math.max(maxRunning, running);
      live.push({ matchId: created.matchId, a, b, special });
    }
    // 2) Results, table by table.
    for (const m of live) {
      const v = await versionOf(m.matchId);
      if (m.special === "ABANDON") {
        await abandonEloMatch(
          o.referee,
          { matchId: m.matchId, expectedVersion: v.version, reason: "Tisch gebraucht" },
          opts,
        );
        running--;
        stats.abandoned++;
        continue;
      }
      const pA = 1 / (1 + Math.exp(-3 * (mean(m.a) - mean(m.b))));
      const winner: Side = rng() < pA ? "A" : "B";
      const submitted = await submitEloResult(
        m.a[0],
        {
          matchId: m.matchId,
          expectedVersion: v.version,
          winnerSide: winner,
          endType: "REGULAR",
          idempotencyKey: randomUUID(),
        },
        opts,
      );
      running--;
      if (m.special === "DISPUTE") {
        const d = await disputeEloResult(
          m.b[0],
          {
            matchId: m.matchId,
            resultVersion: submitted.resultVersion,
            note: "Stimmt so nicht",
            idempotencyKey: randomUUID(),
          },
          opts,
        );
        await staffFinalizeEloResult(
          o.referee,
          {
            matchId: m.matchId,
            expectedVersion: d.version,
            winnerSide: winner === "A" ? "B" : "A",
            endType: "REGULAR",
            reason: "Beide Teams befragt",
            idempotencyKey: randomUUID(),
          },
          opts,
        );
        stats.disputesResolved++;
        completedIds.push(m.matchId);
        continue;
      }
      if (m.special === "VOID") {
        await voidEloResult(
          o.referee,
          { matchId: m.matchId, expectedVersion: submitted.version, reason: "Falscher Tisch" },
          opts,
        );
        stats.voided++;
        continue;
      }
      const confirm = (key: string) =>
        confirmEloResult(
          m.b[0],
          { matchId: m.matchId, resultVersion: submitted.resultVersion, idempotencyKey: key },
          opts,
        );
      if (m.special === "DOUBLE_CONFIRM") {
        // The same request twice at the same time (double tap, flaky network): rated once.
        const key = randomUUID();
        const [x, y] = await Promise.all([confirm(key), confirm(key)]);
        if (x.confirmed?.sequence === y.confirmed?.sequence) stats.idempotentReplays++;
      } else {
        await confirm(randomUUID());
      }
      completedIds.push(m.matchId);
    }
    log(`round ${round + 1}/${rounds}: ${completedIds.length} confirmed`);
  }

  // 3) The admin corrects an early result: a new calculation run replays everything after it.
  const early = await client.eloMatch.findUniqueOrThrow({ where: { id: completedIds[1] } });
  const corrected = await correctEloMatch(
    o.admin,
    {
      matchId: early.id,
      expectedVersion: early.version,
      resultVersion: early.resultVersion,
      changes: {
        winnerSide: early.winnerSide === "A" ? "B" : "A",
        cupsRemainingA: null,
        cupsRemainingB: null,
      },
      reason: "Sieger vertauscht (Simulation)",
      idempotencyKey: randomUUID(),
    },
    opts,
  );
  // 4) A manual recalculation must reproduce exactly the same projection.
  const before = await verifyRatings(session.id, client);
  const recalc = await recalculateElo(
    o.admin,
    { sessionId: session.id, reason: "Kontrolle (Simulation)", confirmText: ELO_RECALC_CONFIRM_TEXT },
    opts,
  );
  const verify = await verifyRatings(session.id, client);

  const [leftoverPlayerLocks, leftoverLiveMatches, ratings, runs, completed] = await Promise.all([
    client.eloActivePlayer.count({ where: { sessionId: session.id } }),
    client.eloMatch.count({ where: { sessionId: session.id, status: { in: ["DRAFT", "IN_PROGRESS"] } } }),
    client.eloPlayerRating.findMany({
      where: { sessionId: session.id },
      include: { user: { select: { displayName: true } } },
    }),
    client.eloRatingRun.count({ where: { sessionId: session.id } }),
    client.eloMatch.findMany({
      where: { sessionId: session.id, status: "COMPLETED" },
      select: { rated: true, ratingMultiplier: true },
    }),
  ]);
  const run = await client.eloRatingRun.findFirstOrThrow({
    where: { sessionId: session.id, supersededAt: null },
  });

  // 5) Close the round: champion(s) among the eligible players.
  const closed = await closeEloSession(
    o.admin,
    {
      sessionId: session.id,
      expectedConfigVersion: (await client.eloSession.findUniqueOrThrow({ where: { id: session.id } }))
        .configVersion,
      confirmText: ELO_CLOSE_CONFIRM_TEXT,
    },
    opts,
  );
  const names = new Map(ratings.map((r) => [r.userId, r.user.displayName]));
  const top = [...ratings]
    .sort((x, y) => y.rating - x.rating || x.userId.localeCompare(y.userId))
    .slice(0, 5);

  return {
    seed: o.seed,
    tournamentId: o.tournamentId,
    sessionId: session.id,
    players: o.players.length,
    matches: {
      created: stats.created,
      completed: completed.length,
      rated: completed.filter((m) => m.rated).length,
      friendlies: stats.friendlies,
      repeatsReduced: completed.filter((m) => m.rated && m.ratingMultiplier != null && m.ratingMultiplier < 1)
        .length,
      cancelled: stats.cancelled,
      voided: stats.voided,
      abandoned: stats.abandoned,
      disputesResolved: stats.disputesResolved,
    },
    teamSizes,
    maxConcurrentRunning: maxRunning,
    idempotentReplays: stats.idempotentReplays,
    correction: { matchId: early.id, runRevision: corrected.runRevision },
    recalculationDigestUnchanged: recalc.digest === before.digest,
    runs,
    verify,
    leftoverPlayerLocks,
    leftoverLiveMatches,
    ratingSum: ratings.reduce((s, r) => s + r.rating, 0),
    expectedRatingSum: ratings.length * run.initialRating,
    champions: closed.championUserIds.map((id) => names.get(id) ?? id),
    top5: top.map((r) => ({
      name: r.user.displayName,
      rating: r.rating,
      games: r.gamesPlayed,
      wins: r.wins,
    })),
    eligible: closed.eligiblePlayers,
  };
}

const fmt = (n: number, digits = 1) => n.toFixed(digits);

/** Markdown section for docs/elo-mode/rating-validation.md (generated by `pnpm simulate:elo`). */
export function eventSimMarkdown(r: EloEventSimReport, generatedAt: string): string {
  const m = r.matches;
  const sizes = Object.entries(r.teamSizes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}×`)
    .join(", ");
  return [
    `_Generated ${generatedAt} with seed ${r.seed}: ${r.players} players, two tables, real services and database._`,
    "",
    "| Check | Result |",
    "| --- | --- |",
    `| Matches created / confirmed | ${m.created} / ${m.completed} (${m.rated} rated, ${m.friendlies} friendlies) |`,
    `| Repeat rule applied (multiplier < 1) | ${m.repeatsReduced} matches |`,
    `| Special cases | ${m.cancelled} cancelled draft, ${m.disputesResolved} dispute resolved by the referee, ${m.voided} pending result voided, ${m.abandoned} running match abandoned |`,
    `| Team sizes | ${sizes} |`,
    `| Matches running at the same time | ${r.maxConcurrentRunning} |`,
    `| Same confirmation sent twice in parallel | rated once (${r.idempotentReplays} idempotent replay) |`,
    `| Early correction | new calculation run ${r.correction.runRevision}, everything after it replayed |`,
    `| Manual recalculation | ${r.recalculationDigestUnchanged ? "identical digest" : "**digest changed**"} |`,
    `| Dry run ("Prüfen") | max. deviation ${r.verify.maxDeviation}, ${r.verify.mismatchedUserIds.length} mismatches |`,
    `| Zero sum | Σ ratings ${fmt(r.ratingSum, 6)} = ${r.players === 0 ? 0 : fmt(r.expectedRatingSum, 6)} expected (error ${r.verify.conservationError.toExponential(1)}) |`,
    `| Locks left after the evening | ${r.leftoverPlayerLocks} player locks, ${r.leftoverLiveMatches} live matches |`,
    `| Calculation runs | ${r.runs} (initial, correction, manual recalculation) |`,
    `| Champion(s) | ${r.champions.join(", ") || "none"} (${r.eligible} eligible) |`,
    "",
    "| Rank | Player | Elo | Matches | Wins |",
    "| --- | --- | --- | --- | --- |",
    ...r.top5.map((p, i) => `| ${i + 1} | ${p.name} | ${fmt(p.rating)} | ${p.games} | ${p.wins} |`),
  ].join("\n");
}
