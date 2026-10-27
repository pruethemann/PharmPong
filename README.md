# PharmaPong 🧪🏓

Beer-Pong-Turnierplattform for the PharmaPong event at the Pharmazentrum, Universität Basel.
Mobile-first, German UI, 24 players / 12 teams / 4 groups / 19 matches on 2 tables.

Two game modes, switched by the admin: the **tournament** (fixed 2-player teams, groups, knockout, referees,
countdown) and **Elo Mode** for the apéro afterwards (spontaneous matches with temporary 1–4-player teams,
count-up stopwatch, individual session Elo starting at 100, results confirmed by both teams). Elo Mode:
[user guide](docs/elo-mode/user-guide.md) · [admin guide](docs/elo-mode/admin-guide.md) ·
[rating system](docs/elo-mode/rating-system.md).

## Stack

Next.js 16 (App Router), React 19 · TypeScript strict · Tailwind v4 + shadcn/ui · Prisma 7 + PostgreSQL ·
Zod · React Hook Form · Vitest · Playwright · Railway.

## Local development

```bash
pnpm install
cp .env.example .env          # adjust if needed
pnpm db:up                    # Postgres 17 in Docker on :54329 (dev, test, e2e DBs)
pnpm db:migrate               # apply migrations to the dev DB
pnpm seed:admin               # open tournament + admin from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD
pnpm admin:create --email you@example.com   # optional: your own admin (prints a one-time password)
pnpm seed:demo                # optional: 24 demo players + 12 teams
pnpm dev                      # http://localhost:3000
```

## Quality gates

| Command                           | What                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| `pnpm typecheck`                  | Prisma generate + `tsc --noEmit`                              |
| `pnpm lint` / `pnpm format:check` | ESLint / Prettier                                             |
| `pnpm test:unit`                  | Pure domain logic (`src/**/*.test.ts`)                        |
| `pnpm test:int`                   | Integration tests against the `pharmapong_test` DB            |
| `pnpm test:e2e`                   | Playwright (desktop + mobile) against the `pharmapong_e2e` DB |
| `pnpm verify`                     | All of the above except E2E                                   |

## Demo data & scenarios

```bash
pnpm scenario registration    # 12 complete teams, registration open
pnpm scenario groups           # group stage: results, 2 live matches, 1 awaiting confirmation
pnpm scenario knockout         # quarterfinals running
pnpm scenario completed        # full 19-match tournament incl. tie, shootout, correction, champion
pnpm scenario elo              # after the final: Elo Mode with ~24 matches, 2 live, 1 pending, 1 dispute
```

Each scenario starts a fresh tournament (the previous one is cancelled; its history is kept).
Logins with password `pharmapong-demo`:

| Account                                             | Role    |
| --------------------------------------------------- | ------- |
| `dev-admin@pharmapong.test`                         | Admin   |
| `schiri@pharmapong.test`                            | Referee |
| `demo01@pharmapong.test` … `demo24@pharmapong.test` | Players |

The demo/simulation scripts refuse to run in production unless `ALLOW_DEMO_SEED=true`.
The `@pharmapong.test` domain is reserved and cannot be used for self-registration.

## Routes

| Route                             | Who                 | What                                                       |
| --------------------------------- | ------------------- | ---------------------------------------------------------- |
| `/`                               | everyone            | dashboard: phase, live tables, next matches, my next match |
| `/register`, `/login`, `/profile` | everyone            | accounts                                                   |
| `/team`, `/join/[code]`           | players             | create/join teams, invitations, logo                       |
| `/tournament`                     | everyone            | groups, knockout bracket, schedule                         |
| `/matches/[id]`                   | everyone            | match details and timeline                                 |
| `/rules`                          | everyone            | PharmaPong rules (reference vs house rules)                |
| `/referee`                        | referees            | table operation, timer, two-step result entry              |
| `/admin`                          | admins              | overview, tournament, matches, teams, users, audit         |
| `/display`                        | public (if enabled) | 16:9 projector mode (tournament or Elo view)               |
| `/elo/play`                       | players             | Elo match builder (table → teams → preview)                |
| `/elo/matches/[id]`               | everyone            | Elo match: consent, stopwatch, result, confirmation        |
| `/elo/rankings`                   | everyone            | Elo leaderboard                                            |
| `/elo/players/[id]`, `/me`        | everyone / players  | Elo profile with rating chart                              |
| `/elo/table/[number]`             | everyone            | QR landing page of a table (grants nothing by itself)      |
| `/elo/referee`                    | referees            | disputes, pending results, drafts                          |
| `/admin/elo`, `/print/elo-qr`     | admins              | Elo administration, printable table QR codes               |
| `/api/health`                     | monitoring          | DB health check                                            |

## Tools

| Command             | What                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm admin:create` | Create an admin account or promote an existing one ([guide](docs/admin-accounts.md))         |
| `pnpm seed:demo`    | Demo users and teams                                                                         |
| `pnpm simulate`     | Plays a complete 19-match tournament on the dev DB                                           |
| `pnpm export`       | JSON/CSV export of standings and results to `data/`                                          |
| `pnpm elo:validate` | Elo Mode: Monte Carlo validation of the rating engine → `docs/elo-mode/rating-validation.md` |
| `pnpm simulate:elo` | Elo Mode: a whole evening through the real services on a scratch DB, all guarantees checked  |

## Deployment

**Live:** https://web-production-13b1f.up.railway.app (Railway project _PharmaPong_: `web` + Postgres + bucket `pharmapong-logos`).
Procedure, variables, backups and runbook: [docs/deployment.md](docs/deployment.md).
Admin account on Railway: `railway ssh --service web -- pnpm admin:create --email <e-mail>` (step by step, also locally:
[docs/admin-accounts.md](docs/admin-accounts.md)).

## Documentation

- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)
- [Tournament rules](docs/tournament-rules.md)
- [Database](docs/database.md)
- [Deployment](docs/deployment.md)
- [Admin accounts](docs/admin-accounts.md)
- [Test plan](docs/test-plan.md)
- Elo Mode: [user guide](docs/elo-mode/user-guide.md), [admin guide](docs/elo-mode/admin-guide.md),
  [rating system](docs/elo-mode/rating-system.md), [validation](docs/elo-mode/rating-validation.md),
  [implementation plan](docs/elo-mode/implementation-plan.md)
- [Changelog](CHANGELOG.md)
