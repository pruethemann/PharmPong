# PharmaPong 🧪🏓

Beer-Pong-Turnierplattform for the PharmaPong event at the Pharmazentrum, Universität Basel.
Mobile-first, German UI, 24 players / 12 teams / 4 groups / 19 matches on 2 tables.

## Stack

Next.js 16 (App Router), React 19 · TypeScript strict · Tailwind v4 + shadcn/ui · Prisma 7 + PostgreSQL ·
Zod · React Hook Form · Vitest · Playwright · Railway.

## Local development

```bash
pnpm install
cp .env.example .env          # adjust if needed
pnpm db:up                    # Postgres 17 in Docker on :54329 (dev, test, e2e DBs)
pnpm db:migrate               # apply migrations to the dev DB
pnpm seed:admin               # create the admin from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD
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
| `/display`                        | public (if enabled) | 16:9 projector mode                                        |
| `/api/health`                     | monitoring          | DB health check                                            |

## Tools

| Command          | What                                                |
| ---------------- | --------------------------------------------------- |
| `pnpm seed:demo` | Demo users and teams                                |
| `pnpm simulate`  | Plays a complete 19-match tournament on the dev DB  |
| `pnpm export`    | JSON/CSV export of standings and results to `data/` |

## Documentation

- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)
- [Tournament rules](docs/tournament-rules.md)
- [Database](docs/database.md)
- [Deployment](docs/deployment.md)
- [Test plan](docs/test-plan.md)
