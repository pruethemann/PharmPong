# PharmaPong 🧪🏓

Beer-Pong-Turnierplattform for the PharmaPong event at the Pharmazentrum, Universität Basel.
Mobile-first, German UI, 24 players / 12 teams / 4 groups / 19 matches on 2 tables.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 + shadcn/ui · Prisma 7 + PostgreSQL ·
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
