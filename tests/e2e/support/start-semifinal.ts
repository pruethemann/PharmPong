// e2e fixture on top of `pnpm scenario knockout` (two quarterfinals confirmed, two live):
// make SF1 ready, free a table, then assign and start SF1, so that correcting one of SF1's
// quarterfinals hits a downstream match that has already begun.
//   DATABASE_URL=… pnpm tsx tests/e2e/support/start-semifinal.ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../../../src/server/db";
import type { Actor } from "../../../src/server/auth/sessions";
import * as matches from "../../../src/server/services/matches";
import * as results from "../../../src/server/services/results";

const AT_TABLE = ["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] as const;

async function actor(email: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, mustChangePassword: false };
}

async function finish(referee: Actor, code: string, tournamentId: string) {
  const m = await db.match.findFirstOrThrow({ where: { tournamentId, code } });
  const p = await results.proposeResult(referee, {
    matchId: m.id,
    expectedVersion: m.version,
    idempotencyKey: randomUUID(),
    winnerTeamId: m.homeTeamId!,
    homeCupsRemaining: 4,
    awayCupsRemaining: 0,
    endType: "REGULAR",
  });
  await results.confirmResult(referee, {
    matchId: m.id,
    expectedVersion: p.version,
    resultRevision: p.resultRevision,
    idempotencyKey: randomUUID(),
  });
}

async function main() {
  const referee = await actor("schiri@pharmapong.test");
  const admin = await actor("dev-admin@pharmapong.test");
  const t = await db.tournament.findFirstOrThrow({
    where: { status: "KNOCKOUT_STAGE" },
    orderBy: { createdAt: "desc" },
  });
  const load = () => db.match.findMany({ where: { tournamentId: t.id, stage: "KNOCKOUT" } });

  let all = await load();
  const sf1 = all.find((m) => m.code === "SF1")!;
  const feeders = [sf1.homeSource, sf1.awaySource].map((s) => s?.replace(/^W:/, ""));
  for (const code of feeders) {
    const m = all.find((x) => x.code === code)!;
    if (m.status === "IN_PROGRESS") await finish(referee, m.code, t.id);
  }
  all = await load();
  const busy = () => all.filter((m) => (AT_TABLE as readonly string[]).includes(m.status) && m.tableId);
  if (busy().length >= 2) {
    await finish(referee, busy()[0].code, t.id);
    all = await load();
  }
  const used = new Set(busy().map((m) => m.tableId));
  const table = (
    await db.gameTable.findMany({
      where: { tournamentId: t.id, isDisabled: false },
      orderBy: { number: "asc" },
    })
  ).find((tb) => !used.has(tb.id));
  if (!table) throw new Error("no free table");
  const fresh = all.find((m) => m.code === "SF1")!;
  if (fresh.status !== "READY") throw new Error(`SF1 is ${fresh.status}, expected READY`);
  const a = await matches.assignMatch(admin, {
    matchId: fresh.id,
    tableId: table.id,
    expectedVersion: fresh.version,
  });
  await matches.startMatch(referee, { matchId: fresh.id, expectedVersion: a.version });
  console.log(`[e2e] SF1 (${feeders.join(" vs ")}) started on Tisch ${table.number}`);
}

main()
  .catch((e) => {
    console.error("[e2e] start-semifinal failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
