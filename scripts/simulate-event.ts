// Play a complete simulated PharmaPong event (24 players, 12 teams, 19 matches)
// against DATABASE_URL through the real services.
// Usage: pnpm simulate [--fresh] [--seed=42]
//   --fresh  cancel the open tournament (if any) and start a new one first
// Refuses with NODE_ENV=production unless ALLOW_DEMO_SEED=true.
import "dotenv/config";
import { db } from "../src/server/db";
import { isDomainError } from "../src/server/domain/errors";
import { ensureTournament } from "../src/server/services/bootstrap";
import { buildPublicSnapshot } from "../src/server/services/live-snapshot";
import { CANCEL_CONFIRM_TEXT, cancelTournament } from "../src/server/services/tournament";
import { assertDemoSeedAllowed } from "../src/server/sim/demo-data";
import { ensureSimAdmin, simulateTournament } from "../src/server/sim/simulate-tournament";

function parseArgs(argv: string[]) {
  const fresh = argv.includes("--fresh");
  const seedArg = argv.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? Number(seedArg.slice("--seed=".length)) : 42;
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  return { fresh, seed };
}

async function main() {
  assertDemoSeedAllowed();
  const { fresh, seed } = parseArgs(process.argv.slice(2));

  const open = await db.tournament.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: {
      id: true,
      name: true,
      status: true,
      drawGeneratedAt: true,
      _count: { select: { groups: true } },
    },
  });
  const hasDraw = !!open && (open.drawGeneratedAt !== null || open._count.groups > 0);
  if (open && hasDraw && !fresh) {
    console.error(
      `[simulate] the open tournament "${open.name}" (${open.status}) already has a draw. ` +
        "Re-run with --fresh to cancel it and simulate in a new tournament.",
    );
    process.exitCode = 1;
    return;
  }
  if (open && fresh) {
    const admin = await ensureSimAdmin(db);
    await cancelTournament(
      admin,
      { reason: "Neue Simulation (--fresh)", confirmText: CANCEL_CONFIRM_TEXT },
      { tournamentId: open.id },
    );
    console.log(`[simulate] cancelled open tournament ${open.id} (${open.status})`);
  }
  const tournamentId = await ensureTournament(db);

  const report = await simulateTournament({
    seed,
    tournamentId,
    demoPassword: process.env.DEMO_PASSWORD || undefined,
    log: (m) => console.log(`[simulate] ${m}`),
  });

  const snap = await buildPublicSnapshot(report.tournamentId);
  const teamName = new Map(snap.teams.map((t) => [t.id, t.name]));
  console.log("\n=== PharmaPong simulation ===");
  console.log(`Tournament: ${report.tournamentId} (seed ${report.seed})`);
  console.log(`Matches played: ${report.matchesPlayed}, max concurrent: ${report.maxConcurrentInProgress}`);
  console.log(`Revision: ${report.revisionBefore} → ${report.revisionAfter}`);
  console.log(`\nChampion: ${report.championName}\n`);
  for (const g of snap.groups) {
    console.log(`Gruppe ${g.name}`);
    for (const r of g.rows) {
      const diff = r.cupDiff > 0 ? `+${r.cupDiff}` : String(r.cupDiff);
      console.log(
        `  ${r.rank ?? "-"}. ${(teamName.get(r.teamId) ?? r.teamId).padEnd(22)} ${r.points} Pkt  ` +
          `${r.cupsFor}:${r.cupsAgainst} (${diff})${r.decidedBy === "SHOOTOUT" ? "  [Shootout]" : ""}`,
      );
    }
  }
  console.log("\nK.-o.-Phase");
  for (const m of snap.matches.filter((x) => x.stage === "KNOCKOUT")) {
    const home = teamName.get(m.homeTeamId ?? "") ?? "?";
    const away = teamName.get(m.awayTeamId ?? "") ?? "?";
    const res = m.result
      ? `${m.result.homeCupsRemaining}:${m.result.awayCupsRemaining} ${m.result.endType} → ${teamName.get(m.result.winnerTeamId)}`
      : m.status;
    console.log(`  ${m.code.padEnd(4)} ${home} vs ${away}: ${res}`);
  }
  console.log("\nEvents of interest");
  for (const e of report.events) console.log(`  - ${e.kind}${e.code ? ` (${e.code})` : ""}: ${e.detail}`);
}

main()
  .catch((e) => {
    console.error("[simulate] failed:", isDomainError(e) ? `${e.code}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
