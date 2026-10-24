// Put the database (DATABASE_URL) into a realistic state for UI development and demos.
//
//   pnpm tsx scripts/dev-scenario.ts registration   12 complete teams, registration open
//   pnpm tsx scripts/dev-scenario.ts groups         group stage running: results, 2 live matches, 1 awaiting confirmation
//   pnpm tsx scripts/dev-scenario.ts knockout       knockout running: QF1/QF2 done, QF3/QF4 live
//   pnpm tsx scripts/dev-scenario.ts completed      full 19-match simulation incl. tie, shootout, correction
//
// Always starts from a fresh tournament (the open one is cancelled, history is kept).
// Logins (password "pharmapong-demo"): dev-admin@pharmapong.test (ADMIN),
// schiri@pharmapong.test (REFEREE), demo01..demo24@pharmapong.test (players).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import type { Actor } from "../src/server/auth/sessions";
import { ensureTournament } from "../src/server/services/bootstrap";
import { loadTournamentState } from "../src/server/services/state";
import * as tournament from "../src/server/services/tournament";
import * as matches from "../src/server/services/matches";
import * as results from "../src/server/services/results";
import { adminCreateTeam } from "../src/server/services/teams";
import {
  DEMO_TEAMS,
  DEMO_REFEREE_EMAIL,
  demoEmail,
  assertDemoSeedAllowed,
} from "../src/server/sim/demo-data";
import { seededRng, simulateTournament } from "../src/server/sim/simulate-tournament";
import { suggestAssignments } from "../src/server/domain/scheduler";

const PASSWORD = "pharmapong-demo";
const DEV_ADMIN_EMAIL = "dev-admin@pharmapong.test";
type Mode = "registration" | "groups" | "knockout" | "completed";

async function upsertUser(email: string, displayName: string, role: Actor["role"], passwordHash: string) {
  const u = await db.user.upsert({
    where: { email },
    update: { role, isActive: true, mustChangePassword: false },
    create: { email, displayName, role, passwordHash, mustChangePassword: false },
  });
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: false,
  } as Actor;
}

const FIRST_NAMES = [
  "Lea",
  "Noah",
  "Mia",
  "Luca",
  "Lina",
  "Elias",
  "Sofia",
  "Levin",
  "Emma",
  "Nico",
  "Laura",
  "Jonas",
  "Sara",
  "Jan",
  "Anna",
  "Leon",
  "Nina",
  "Tim",
  "Julia",
  "Fabian",
  "Alina",
  "David",
  "Chiara",
  "Robin",
];

async function freshTournament(admin: Actor): Promise<string> {
  const open = await db.tournament.findFirst({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (open) {
    if (open.status === "DRAFT") {
      await db.tournament.update({ where: { id: open.id }, data: { status: "CANCELLED" } });
    } else {
      await tournament.cancelTournament(
        admin,
        { reason: "Dev-Szenario neu aufgesetzt", confirmText: tournament.CANCEL_CONFIRM_TEXT },
        { tournamentId: open.id },
      );
    }
  }
  return ensureTournament();
}

async function registration(admin: Actor): Promise<string> {
  const tournamentId = await freshTournament(admin);
  await tournament.openRegistration(admin, { tournamentId });
  const hash = await hashPassword(PASSWORD);
  const players: Actor[] = [];
  for (let i = 1; i <= 24; i++) {
    players.push(
      await upsertUser(
        demoEmail(i),
        `${FIRST_NAMES[i - 1]} ${String.fromCharCode(64 + ((i * 7) % 26) + 1)}.`,
        "PLAYER",
        hash,
      ),
    );
  }
  for (const [i, t] of DEMO_TEAMS.entries()) {
    await adminCreateTeam(
      admin,
      {
        name: t.name,
        motto: t.motto,
        memberUserIds: [players[2 * i].id, players[2 * i + 1].id],
        reason: "Dev-Szenario",
      },
      { tournamentId },
    );
  }
  await db.teamMember.updateMany({ where: { tournamentId }, data: { isReady: true } });
  return tournamentId;
}

async function startedGroupStage(admin: Actor): Promise<string> {
  const tournamentId = await registration(admin);
  await tournament.lockRegistration(admin, { tournamentId });
  await tournament.generateDraw(admin, { rng: seededRng(42) }, { tournamentId });
  await tournament.startGroupStage(admin, { tournamentId });
  return tournamentId;
}

/** Assign the scheduler's suggestions and start them; returns started match ids. */
async function startNext(admin: Actor, referee: Actor, tournamentId: string, count = 2): Promise<string[]> {
  const state = await loadTournamentState(db, tournamentId);
  const started: string[] = [];
  for (const s of suggestAssignments(state.matches, state.tables).slice(0, count)) {
    const m = state.matches.find((x) => x.id === s.matchId)!;
    const a = await matches.assignMatch(admin, {
      matchId: m.id,
      tableId: s.tableId,
      expectedVersion: m.row.version,
    });
    await matches.startMatch(referee, { matchId: m.id, expectedVersion: a.version });
    started.push(m.id);
  }
  return started;
}

/** Deterministic plausible result: home wins on odd orderIndex. */
async function finish(
  referee: Actor,
  matchId: string,
  confirm = true,
  endType: "REGULAR" | "TIME_LIMIT" = "REGULAR",
) {
  const m = await db.match.findUniqueOrThrow({ where: { id: matchId } });
  const homeWins = m.orderIndex % 2 === 1;
  const winnerCups = 1 + (m.orderIndex % 6);
  let type = endType;
  let loserCups = 0;
  if (type === "TIME_LIMIT") {
    loserCups = winnerCups - 2;
    if (loserCups < 1) {
      type = "REGULAR";
      loserCups = 0;
    }
  }
  const r = await results.proposeResult(referee, {
    matchId,
    expectedVersion: m.version,
    idempotencyKey: randomUUID(),
    winnerTeamId: homeWins ? m.homeTeamId! : m.awayTeamId!,
    homeCupsRemaining: homeWins ? winnerCups : loserCups,
    awayCupsRemaining: homeWins ? loserCups : winnerCups,
    endType: type,
  });
  if (confirm) {
    await results.confirmResult(referee, {
      matchId,
      expectedVersion: r.version,
      resultRevision: r.resultRevision,
      idempotencyKey: randomUUID(),
    });
  }
}

async function playGroupMatches(admin: Actor, referee: Actor, tournamentId: string, rounds: number) {
  for (let i = 0; i < rounds; i++) {
    const ids = await startNext(admin, referee, tournamentId);
    for (const [j, id] of ids.entries()) await finish(referee, id, true, j === 1 ? "TIME_LIMIT" : "REGULAR");
  }
}

async function main() {
  assertDemoSeedAllowed();
  const mode = process.argv[2] as Mode;
  if (!["registration", "groups", "knockout", "completed"].includes(mode)) {
    throw new Error("Usage: tsx scripts/dev-scenario.ts registration|groups|knockout|completed");
  }
  const hash = await hashPassword(PASSWORD);
  const admin = await upsertUser(DEV_ADMIN_EMAIL, "Dev-Admin", "ADMIN", hash);
  const referee = await upsertUser(DEMO_REFEREE_EMAIL, "Schiri Sam", "REFEREE", hash);

  if (mode === "registration") {
    await registration(admin);
  } else if (mode === "groups") {
    const tournamentId = await startedGroupStage(admin);
    await playGroupMatches(admin, referee, tournamentId, 3); // 6 confirmed
    const live = await startNext(admin, referee, tournamentId); // 2 in progress
    await finish(referee, live[1], false, "TIME_LIMIT"); // 1 awaiting confirmation
    await tournament.updateSettings(admin, { publicDisplayEnabled: true }, { tournamentId });
  } else if (mode === "knockout") {
    const tournamentId = await startedGroupStage(admin);
    await playGroupMatches(admin, referee, tournamentId, 6); // all 12 group matches
    await tournament.startKnockout(admin, { tournamentId });
    await playGroupMatches(admin, referee, tournamentId, 1); // QF1 + QF2 confirmed
    await startNext(admin, referee, tournamentId); // QF3 + QF4 live
    await tournament.updateSettings(admin, { publicDisplayEnabled: true }, { tournamentId });
  } else {
    const admin2 = admin;
    const tournamentId = await freshTournament(admin2);
    const report = await simulateTournament({ seed: 7, tournamentId, demoPassword: PASSWORD });
    await db.tournament.update({ where: { id: tournamentId }, data: { publicDisplayEnabled: true } });
    console.log(`[dev-scenario] champion: ${report.championName}`);
  }
  const t = await db.tournament.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  console.log(`[dev-scenario] ${mode}: tournament ${t.id} status=${t.status} revision=${t.revision}`);
  console.log(
    `[dev-scenario] logins (password "${PASSWORD}"): ${DEV_ADMIN_EMAIL}, ${DEMO_REFEREE_EMAIL}, demo01..24@pharmapong.test`,
  );
}

main()
  .catch((e) => {
    console.error("[dev-scenario] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
