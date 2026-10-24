// Seed 24 demo players, 12 complete teams and a demo referee.
// Usage: pnpm seed:demo   (password from DEMO_PASSWORD, default below)
// Refuses to run with NODE_ENV=production unless ALLOW_DEMO_SEED=true.
// Prints only counts and the password hint, never other secrets.
import "dotenv/config";
import { db } from "../src/server/db";
import { DEMO_REFEREE_EMAIL, demoEmail, seedDemo } from "../src/server/sim/demo-data";

const DEFAULT_DEMO_PASSWORD = "pharmapong-demo";

async function main() {
  const fromEnv = !!process.env.DEMO_PASSWORD;
  const password = process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
  const r = await seedDemo(db, { password });
  if (!r.created) {
    console.log("[seed-demo] demo users already exist: nothing to do");
    return;
  }
  console.log(`[seed-demo] created ${r.users} players, ${r.teams} complete teams, ${r.referees} referee`);
  console.log(`[seed-demo] logins: ${demoEmail(1)} … ${demoEmail(r.users)}, referee ${DEMO_REFEREE_EMAIL}`);
  console.log(
    fromEnv
      ? "[seed-demo] password: the value of DEMO_PASSWORD"
      : `[seed-demo] password: "${DEFAULT_DEMO_PASSWORD}" (set DEMO_PASSWORD to override)`,
  );
}

main()
  .catch((e) => {
    console.error("[seed-demo] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
