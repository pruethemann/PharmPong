// PharmaElo validation (spec §11.5): Monte Carlo simulation of social events, written to
// data/elo-validation/*.json and into the generated section of docs/elo-mode/rating-validation.md.
// Usage: pnpm elo:validate [--seeds=500] [--no-doc]
// Pure computation: no database, no network. Deterministic for a given seed count.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { buildReport, reportMarkdown } from "../src/server/sim/elo-report";

const DOC = path.resolve(process.cwd(), "docs/elo-mode/rating-validation.md");
const BEGIN = "<!-- BEGIN GENERATED: pnpm elo:validate -->";
const END = "<!-- END GENERATED -->";

function zurichStamp(d: Date): { file: string; human: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    file: `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}`,
    human: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (Europe/Zurich)`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const seedsArg = args.find((a) => a.startsWith("--seeds="));
  const seeds = seedsArg ? Number(seedsArg.slice("--seeds=".length)) : 500;
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds must be a positive integer");

  const stamp = zurichStamp(new Date());
  const started = Date.now();
  const report = buildReport(seeds, stamp.human);

  const dir = path.resolve(process.cwd(), "data/elo-validation");
  await mkdir(dir, { recursive: true });
  const jsonFile = path.join(dir, `elo-validation-${stamp.file}.json`);
  await writeFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `[elo:validate] ${seeds} seeds × ${report.scenarios.length} scenarios in ${Date.now() - started} ms`,
  );
  console.log(`[elo:validate] wrote ${path.relative(process.cwd(), jsonFile)}`);

  if (args.includes("--no-doc")) return;
  const doc = await readFile(DOC, "utf8");
  const from = doc.indexOf(BEGIN);
  const to = doc.indexOf(END);
  if (from < 0 || to < from) throw new Error(`markers not found in ${DOC}`);
  const updated = `${doc.slice(0, from + BEGIN.length)}\n\n${reportMarkdown(report)}\n\n${doc.slice(to)}`;
  const options = (await resolveConfig(DOC)) ?? {};
  await writeFile(DOC, await format(updated, { ...options, filepath: DOC }), "utf8");
  console.log(`[elo:validate] updated ${path.relative(process.cwd(), DOC)}`);
}

main().catch((e) => {
  console.error("[elo:validate] failed:", e);
  process.exitCode = 1;
});
