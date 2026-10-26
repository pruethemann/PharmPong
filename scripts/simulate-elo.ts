// Play a complete simulated Elo evening (24 guests, two tables, 40+ matches with disputes,
// cancellations, a correction and a recalculation) against DATABASE_URL through the real
// services, check every guarantee and write the numbers to data/elo-validation/ and into the
// generated section of docs/elo-mode/rating-validation.md.
// Usage: pnpm simulate:elo [--fresh] [--seed=7] [--no-doc]
//   --fresh  cancel the open tournament (if any) and run in a new one
// Refuses with NODE_ENV=production unless ALLOW_DEMO_SEED=true. Use a scratch database.
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { db } from "../src/server/db";
import { isDomainError } from "../src/server/domain/errors";
import { ensureTournament } from "../src/server/services/bootstrap";
import { CANCEL_CONFIRM_TEXT, cancelTournament } from "../src/server/services/tournament";
import { assertDemoSeedAllowed } from "../src/server/sim/demo-data";
import { ensureSimEloUsers, retireEloSessions } from "../src/server/sim/elo-dev";
import { eventSimMarkdown, simulateEloEvent } from "../src/server/sim/simulate-elo-event";
import { ensureSimAdmin } from "../src/server/sim/simulate-tournament";

const DOC = path.resolve(process.cwd(), "docs/elo-mode/rating-validation.md");
const BEGIN = "<!-- BEGIN GENERATED: pnpm simulate:elo -->";
const END = "<!-- END GENERATED: pnpm simulate:elo -->";

const zurich = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

async function main() {
  assertDemoSeedAllowed();
  const args = process.argv.slice(2);
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? Number(seedArg.slice("--seed=".length)) : 7;
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");

  const open = await db.tournament.findFirst({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (open && !args.includes("--fresh")) {
    console.error(
      `[simulate:elo] tournament "${open.name}" (${open.status}) is open. ` +
        "Re-run with --fresh to cancel it and simulate in a new one (use a scratch database).",
    );
    process.exitCode = 1;
    return;
  }
  const admin = await ensureSimAdmin(db);
  await retireEloSessions(db);
  if (open?.status === "DRAFT") {
    await db.tournament.update({ where: { id: open.id }, data: { status: "CANCELLED" } });
  } else if (open) {
    await cancelTournament(
      admin,
      { reason: "Elo-Simulation (--fresh)", confirmText: CANCEL_CONFIRM_TEXT },
      { tournamentId: open.id },
    );
  }
  const tournamentId = await ensureTournament(db);
  const { referee, players } = await ensureSimEloUsers(db);
  const started = Date.now();
  const report = await simulateEloEvent({
    seed,
    tournamentId,
    admin,
    referee,
    players,
    log: (m) => console.log(`[simulate:elo] ${m}`),
  });
  const ms = Date.now() - started;

  const dir = path.resolve(process.cwd(), "data/elo-validation");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `event-sim-seed${seed}.json`);
  await writeFile(file, `${JSON.stringify({ ...report, durationMs: ms }, null, 2)}\n`, "utf8");
  console.log(
    `[simulate:elo] ${report.matches.completed} confirmed matches in ${ms} ms, wrote ${path.relative(process.cwd(), file)}`,
  );

  const ok =
    report.leftoverPlayerLocks === 0 &&
    report.leftoverLiveMatches === 0 &&
    report.verify.maxDeviation === 0 &&
    report.verify.conservationError < 1e-9 &&
    report.recalculationDigestUnchanged;
  console.log(
    `[simulate:elo] guarantees ${ok ? "hold" : "VIOLATED"}; champion(s): ${report.champions.join(", ")}`,
  );
  if (!ok) process.exitCode = 1;

  if (args.includes("--no-doc")) return;
  const doc = await readFile(DOC, "utf8");
  const from = doc.indexOf(BEGIN);
  const to = doc.indexOf(END);
  if (from < 0 || to < from) throw new Error(`markers not found in ${DOC}`);
  const updated = `${doc.slice(0, from + BEGIN.length)}\n\n${eventSimMarkdown(report, `${zurich(new Date())} (Europe/Zurich)`)}\n\n${doc.slice(to)}`;
  const options = (await resolveConfig(DOC)) ?? {};
  await writeFile(DOC, await format(updated, { ...options, filepath: DOC }), "utf8");
  console.log(`[simulate:elo] updated ${path.relative(process.cwd(), DOC)}`);
}

main()
  .catch((e) => {
    console.error("[simulate:elo] failed:", isDomainError(e) ? `${e.code}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
