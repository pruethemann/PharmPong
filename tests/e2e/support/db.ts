// Direct helpers for the e2e database: scenarios, throttle reset, small queries.
import { execSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { E2E_DATABASE_URL, E2E_ENV } from "./env";

const ROOT = path.join(__dirname, "..", "..", "..");

export type Scenario = "registration" | "groups" | "knockout" | "completed";

function run(cmd: string, attempts = 1) {
  for (let i = 1; ; i++) {
    try {
      execSync(cmd, {
        cwd: ROOT,
        env: { ...process.env, ...E2E_ENV, NODE_ENV: "development" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      return;
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message: string };
      const detail = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`.slice(-2000);
      if (i >= attempts) throw new Error(`"${cmd}" failed:\n${detail || err.message}`);
      console.warn(`[e2e] "${cmd}" failed (attempt ${i}), retrying:\n${detail}`);
    }
  }
}

/**
 * Reset the e2e database into a known tournament state (see scripts/dev-scenario.ts).
 * Retried once: open pages keep polling while the script rewrites the tournament.
 */
export function scenario(mode: Scenario): void {
  run(`pnpm -s scenario ${mode}`, 2);
}

/** Run a TypeScript helper from tests/e2e/support with tsx against the e2e database. */
export function tsx(file: string, ...args: string[]): void {
  run(`pnpm -s exec tsx ${path.join("tests", "e2e", "support", file)} ${args.join(" ")}`);
}

export function migrate(): void {
  run("pnpm -s exec prisma migrate deploy");
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

/** Login/registration throttles count per IP; every run comes from 127.0.0.1. */
export async function clearThrottles(): Promise<void> {
  await sql(`DELETE FROM "AuthThrottle"`);
}
