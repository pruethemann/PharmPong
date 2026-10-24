// Idempotent production bootstrap: open tournament + initial admin.
// Runs in Railway's preDeployCommand. Never prints secrets.
import "dotenv/config";
import { db } from "../src/server/db";
import { ensureAdmin, ensureTournament } from "../src/server/services/bootstrap";

async function main() {
  const tournamentId = await ensureTournament();
  console.log(`[seed-admin] tournament ready (${tournamentId})`);
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    console.log("[seed-admin] ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set: skipping admin creation");
    return;
  }
  if (password.length < 10) throw new Error("ADMIN_INITIAL_PASSWORD must have at least 10 characters");
  const r = await ensureAdmin(email, password);
  console.log(
    `[seed-admin] admin ${r.created ? "created (must change password on first login)" : r.promoted ? "promoted" : "already exists"}`,
  );
}

main()
  .catch((e) => {
    console.error("[seed-admin] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
