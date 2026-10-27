// Create an admin account, or make an existing account an admin. Guide: docs/admin-accounts.md
//   pnpm admin:create --email <e-mail> [--name "<display name>"] [--promote]
//   Railway (runs inside the web service): railway ssh --service web -- pnpm admin:create --email <e-mail>
// A new account gets a one-time password, printed once; the app asks for a new password at first login.
// Interactive use only: never run it from pre-deploy or CI, whose output ends up in logs.
import "dotenv/config";
import { parseArgs } from "node:util";

const USAGE = `Usage: pnpm admin:create --email <e-mail> [--name "<display name>"] [--promote]

  --email <e-mail>  login e-mail of the admin
  --name <name>     display name of a new account (default "Turnierleitung", changeable in the profile)
  --promote         make the existing account with this e-mail an admin (its password stays unchanged)
  -h, --help        show this help

Guide: docs/admin-accounts.md`;

const ROLE = { PLAYER: "player", REFEREE: "referee", ADMIN: "admin" } as const;

function parse(argv: string[]) {
  // `pnpm admin:create -- --email …` passes the separator through.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  return parseArgs({
    args,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      promote: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }).values;
}

// Prisma / driver codes for "no connection to the database server".
const UNREACHABLE = new Set(["P1001", "P1002", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"]);

function explain(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
  const message = (e instanceof Error ? e.message : String(e)).trim();
  if (!UNREACHABLE.has(code)) return message || code || "unknown error";
  return (
    `${message || "Can't reach the database server"} (${code})\n` +
    (/\.railway\.internal\b/.test(process.env.DATABASE_URL ?? "")
      ? "This database is only reachable inside Railway (`railway run` executes on your computer). Use:\n" +
        "  railway ssh --service web -- pnpm admin:create --email <e-mail>"
      : "Is the database running? Locally: pnpm db:up")
  );
}

async function main(): Promise<number> {
  let opts: ReturnType<typeof parse>;
  try {
    opts = parse(process.argv.slice(2));
  } catch (e) {
    console.error(`[admin:create] ${e instanceof Error ? e.message : e}\n\n${USAGE}`);
    return 1;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!opts.email) {
    console.error(`[admin:create] --email is required.\n\n${USAGE}`);
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error(
      "[admin:create] DATABASE_URL is not set. Run it in the project folder (reads .env) or on Railway via `railway ssh`.",
    );
    return 1;
  }

  // Loaded only now, so that --help and usage errors work without a database.
  const { db } = await import("../src/server/db");
  const { createAdminAccount } = await import("../src/server/services/bootstrap");
  try {
    const r = await createAdminAccount({ email: opts.email, displayName: opts.name, promote: opts.promote });
    const who = `"${r.displayName}" <${r.email}>`;
    const nameIgnored =
      opts.name !== undefined && r.status !== "created"
        ? "\n(--name ignored: an existing account keeps its name.)"
        : "";
    switch (r.status) {
      case "created": {
        const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
        console.log(
          [
            `[admin:create] Created the admin account ${who}.`,
            "",
            `  One-time password: ${r.oneTimePassword}`,
            "",
            `Log in ${appUrl ? `at ${appUrl}/login ` : ""}with this e-mail and password; the app then asks for a new password.`,
            "The one-time password is shown only now and is not stored in plain text.",
          ].join("\n"),
        );
        return 0;
      }
      case "promoted":
        console.log(
          (r.previousRole === "ADMIN"
            ? `[admin:create] Reactivated the admin account ${who}. Its password is unchanged.`
            : `[admin:create] ${who} is now an admin (was ${ROLE[r.previousRole]}${r.reactivated ? ", deactivated" : ""}).\n` +
              "Its password is unchanged. It was signed out everywhere: log in again to get the admin menu.") +
            nameIgnored,
        );
        return 0;
      case "already_admin":
        console.log(`[admin:create] ${who} is already an admin. Nothing changed.${nameIgnored}`);
        return 0;
      case "exists":
        console.error(
          `[admin:create] An account with this e-mail already exists: ${who}, ` +
            `${ROLE[r.role]}${r.isActive ? "" : ", deactivated"}. Nothing changed.\n` +
            `Run it again with --promote to ${r.role === "ADMIN" ? "reactivate it" : "make this account an admin"} ` +
            "(its password stays unchanged).",
        );
        return 1;
    }
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`[admin:create] failed: ${explain(e)}`);
    process.exitCode = 1;
  },
);
