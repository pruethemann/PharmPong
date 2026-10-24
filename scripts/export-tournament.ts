// Export a tournament (JSON + standings/matches CSV) into data/.
// Usage: pnpm export [--tournament=<id>]   (default: the current tournament)
// Acts as the first active admin account; the export contains no e-mails or hashes.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/server/db";
import type { Actor } from "../src/server/auth/sessions";
import { isDomainError } from "../src/server/domain/errors";
import { exportTimestamp, exportTournament } from "../src/server/services/export";

async function main() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--tournament="));
  const tournamentId = arg ? arg.slice("--tournament=".length) : undefined;
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, displayName: true, role: true, mustChangePassword: true },
  });
  if (!admin) throw new Error("No active admin account found (run pnpm seed:admin first).");
  const actor: Actor = admin;

  const data = await exportTournament(actor, tournamentId);
  const dir = path.resolve(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `pharmapong-export-${exportTimestamp()}`);
  const files = [
    [`${base}.json`, `${JSON.stringify(data.json, null, 2)}\n`],
    [`${base}-standings.csv`, data.csv.standings],
    [`${base}-matches.csv`, data.csv.matches],
  ] as const;
  for (const [file, content] of files) await writeFile(file, content, "utf8");
  console.log(
    `[export] tournament ${data.tournamentId} (${data.json.tournament.status}): ` +
      `${data.json.matches.length} matches, ${data.json.auditCount} audit entries`,
  );
  for (const [file] of files) console.log(`[export] wrote ${path.relative(process.cwd(), file)}`);
}

main()
  .catch((e) => {
    console.error("[export] failed:", isDomainError(e) ? `${e.code}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
