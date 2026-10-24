# PharmaPong — Implementation Plan

## Context

Build PharmaPong from scratch: a mobile-first Beer Pong tournament app for a private event at the Pharmazentrum, Uni Basel. 24 players, 12 teams, 4 groups of 3, then QF/SF/F: 19 matches on 2 tables. The UI is in German.

- `/Users/husedo15/code/PharmaPong` is empty and not a git repo.
- Toolchain: Node 26, pnpm 11, Docker, Railway CLI, Railway MCP (connected).
- The ui-ux-pro-max skills are available.

**Decisions (from the user):**

- Execution model: **Opus**. The user explicitly confirmed the CLAUDE.md Opus warning.
- Git: `git init`, then one commit per verified phase.
- Pacing: phases 1–7 run continuously; **stop for approval before creating any Railway resources**.
- Deploy: a new Railway project "PharmaPong" with web + Postgres + Bucket, uploaded with `railway up` (CLI/MCP).
- Ultracode is on. Each phase is a Workflow: parallel implementers on disjoint files, then adversarial review/verify agents, then a gate.

**Corrections to the architecture review:**

- Login is by **email**, not username (`User.email @unique`, stored lowercased).
- The display timezone is **Europe/Zurich**.

## Architecture (key decisions)

- **Stack:**
  - Next.js 16 App Router (`proxy.ts`, async `params`/`cookies`), TS strict.
  - Tailwind v4 (CSS-first `@theme`) with shadcn/ui.
  - Prisma 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`, `prisma.config.ts` with dotenv).
  - Zod 4, RHF with `@hookform/resolvers` v5+.
  - Vitest (projects `unit` and `integration`) and Playwright.
- **Auth:** custom DB-backed sessions instead of Auth.js. The spec allows an "equivalent secure implementation", and Auth.js Credentials forces JWT, which would delay role demotion.
  - Session id is sha256 of the token; httpOnly Secure SameSite=Lax cookie with a 14-day sliding expiry.
  - `@node-rs/argon2` with Argon2id (prebuilt binaries, no node-gyp).
  - Login throttle in Postgres: one atomic upsert on `AuthThrottle`, keyed per email and loosely per IP.
  - Admin-generated one-time reset links.
  - Admin seeded from env (`ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`) with `mustChangePassword`.
  - Authorization is checked in every action and route handler. `proxy.ts` only does the cookie-presence redirect.
- **Layout:**
  - `src/server/domain/*`: pure, no prisma/next imports (an ESLint rule enforces this).
  - `src/server/services/*`: transactional operations.
  - `src/server/actions/*`: thin `defineAction({schema, roles, handler})` wrappers.
  - `src/lib/i18n/de.ts`: all German copy.
  - `scripts/`: entry points (seed-admin, seed-demo, simulate-event, export → `data/`, reset-admin-password).
  - `docs/*.md` and `README.md`.
- **Concurrency core:** `withTournamentTx()` in `src/server/services/tx.ts`.
  - Steps: lock the tournament row `FOR UPDATE`, run the work, bump `revision`, write the audit row, commit.
  - Retries on 40001/40P01/P2034.
  - Second protective layer:
    - `Match.version` optimistic check.
    - `SELECT … FOR UPDATE` on matches.
    - Partial unique index for one active match per table.
    - `ActiveTeamMatch(teamId PK)` lock rows for one active match per team.
    - Partial unique indexes for one active team membership per user and max 2 slots per team.
    - CHECK constraints on cups 0–10, winner ∈ teams, and completed ⇒ result.
    - `IdempotencyKey` table for referee submissions.
- **Schema models:**
  - Core: User, Session, PasswordReset, AuthThrottle, Tournament (status, isPaused, publicDisplayEnabled, revision, championTeamId), Team (inviteCode unique, logoKey/logoVersion), TeamMember (leftAt).
  - Tournament structure: Group, GroupAssignment, GroupTiebreak (basisHash invalidates the shootout after corrections), GameTable.
  - Matches: Match (code, stage, round, orderIndex, home/away + source, nextMatchId/nextSlot, timer fields, result fields, resultRevision, version), ActiveTeamMatch.
  - Logs: MatchEvent, AuditLog, IdempotencyKey.
  - Table state (Available/Reserved/InProgress/Disabled) is derived, not stored.
  - Raw SQL goes into migrations via `--create-only`. A schema-invariant test asserts these indexes exist, because Prisma may drop partial indexes.
- **Domain logic:**
  - Crypto Fisher–Yates draw. Round-robin order is interleaved across groups so the two tables never share a team.
  - KO template with explicit advancement links.
  - Standings: points → cup diff → cups for → head-to-head (only when exactly 2 teams are tied) → admin ranking shootout. Never arbitrary.
  - Result rules:
    - REGULAR: the loser has 0 cups left.
    - TIME_LIMIT: the winner has more cups left.
    - SHOOTOUT: cups left are equal; shootout cups are not counted.
    - FORFEIT (admin): the winner counts as 10 cups left, the loser as 0. This is a documented house rule.
  - Scheduler: suggests the earliest READY match whose teams are not busy.
  - Timer: uses DB `now()` as the clock and supports pause accumulation. It never auto-confirms; the client syncs its clock from `serverNow`.
- **Match flow:**
  - Status path: assign → start → propose (step 1) → confirm (step 2, idempotent, version-checked) → advance the winner in the same tx → the Final sets the champion and COMPLETED.
  - `startKnockout` is a manual admin action. It is gated on all group matches being confirmed and no unresolved ties.
  - `correctResult` propagates to downstream slots that have not started. If a downstream match has started it raises `DOWNSTREAM_STARTED`, and the fix goes through the `executeRecovery` wizard: typed confirmation, audited void of the downstream chain.
- **Live sync:** `/api/live?since=rev` (authed) and `/api/live/public` (404 unless public display is enabled).
  - If the revision is unchanged, the response is just `{unchanged, revision, serverNow}`. Otherwise it is a REPEATABLE READ snapshot.
  - The public shape has no emails or invite codes.
  - The `useLive` hook polls every 2.5 s, pauses while the tab is hidden, backs off on errors, shows an offline badge, and refreshes after each action.
- **Storage:** a private S3-compatible Railway Bucket. Logos are ≤1 MB PNG/JPEG/WebP, magic-byte checked, and re-encoded by sharp to 256² WebP. They are served via `/api/logos/[teamId]?v=`. Tests use a memory driver; a MinIO profile is available in docker-compose.

## Phases (each: implement → lint/typecheck/tests → adversarial review → fix → commit)

1. **Repo and database setup:** git init, Next.js scaffold, strict TS, ESLint/Prettier, docker-compose (Postgres 17 on port 54329 with dev/test/e2e DBs), Prisma 7 schema with all models plus raw-SQL migration, `env.ts`, `/api/health`, Vitest harness (TRUNCATE per test), schema-invariant and constraint tests, `pnpm verify` script, pnpm `allowBuilds` (prisma, sharp, esbuild), and a skeleton for the docs and README.
2. **UX design system:** invoke `ui-ux-pro-max:ui-ux-pro-max` (and `design-system`/`brand`) for the 7 requested recommendation topics.
   - Direction: dark theme, vivid "lab" accents, molecule/beaker motifs.
   - Deliverables: `docs/design-system.md` and Tailwind v4 tokens in `globals.css`.
   - Components: shadcn components plus base PharmaPong components (TeamBadge, MatchCard, StatusPill with icon and text, BigTimer, TableBadge, HoldToConfirm for destructive actions).
   - Targets: 48 px minimum touch targets and `prefers-reduced-motion`.
3. **Authentication and teams:**
   - Auth: sessions, register/login/logout, throttling, guards, profile.
   - Teams: create/join/leave, invite link and code with rotation, logo upload, `/team` UI.
   - Admin user management: roles, deactivate, reset link.
   - Tests: authz matrix and join-race tests, plus Playwright registration → invite → join on mobile.
4. **Tournament generation and ranking:** pure domain (state machines, draw, bracket, standings/tiebreak, result rules, scheduler, timer) with ≥95% unit coverage and fast-check properties. Services for lifecycle transitions, generateDraw, audited resetDraw, tiebreak recording, and the demo seeder (24 users / 12 teams).
5. **Match execution and referee tools:**
   - Services: assign/start/pause/propose/confirm/forfeit/correct/recover, plus idempotency.
   - `/referee`: big timer, unmistakable winner selection, cup steppers, review → confirm, server-confirmed success.
   - `/matches/[id]`.
   - Concurrency suite: simultaneous referees, duplicate submissions, table/team double-assignment, rollback.
6. **Live dashboard and bracket:** the live API and `useLive`; `/`, `/tournament` (groups and a horizontally scrolling interactive bracket), `/rules` (official vs house rules, non-alcoholic note), and `/display` (16:9, rotation that never hides active matches, champion/advancement animations with reduced-motion support).
7. **Admin and E2E:**
   - `/admin`: KPIs, teams/groups, scheduler with manual assignment, table disable, pause/resume, forfeits, corrections/recovery wizard, ranking shootouts, audit log, public-display toggle, JSON/CSV export.
   - `full-event.int.test.ts`: 19 matches including a tied group, a shootout, a correction, concurrent tables and a champion.
   - Full Playwright suite (desktop, Pixel 7, iPhone WebKit; reconnect test via route abort; no horizontal overflow).
   - `docs/test-plan.md`.
8. **Railway deploy (paused for user approval first):**
   - Create the project, Postgres, Bucket and web service.
   - Variables via references (never printed); generate the domain and set `APP_URL`.
   - `railway.json`: Railpack build, `preDeployCommand: prisma migrate deploy && tsx scripts/seed-admin.ts`, healthcheck `/api/health`, 1 replica.
   - `railway up`, then health check and a smoke E2E against the production URL.
   - `docs/deployment.md`: backups, restore, restart, break-glass admin reset.

## Verification

- **Every phase:** `pnpm verify` (tsc --noEmit, eslint, prettier --check, vitest unit + integration, next build). After each run, check `git diff HEAD --shortstat` (CLAUDE.md) and commit.
- **Functional:** `pnpm db:up && pnpm db:migrate && pnpm seed:demo && pnpm dev`. Then click through as admin, referee and player, and check `/display` in the browser via Playwright MCP at mobile and 1920×1080.
- **Full simulation:** `pnpm simulate` against the dev DB, plus the integration test asserting 19 matches, consistent standings and bracket, no leftover active locks, and an audit row per edit.
- **Prod:** `/api/health` returns 200 with `db: ok`, a smoke Playwright run on the Railway URL, and logo upload persists across a redeploy.

## Open assumptions (documented in docs/tournament-rules.md, admin-adjustable)

- Forfeit counts as 10:0 cups.
- KO start is manual.
- The Bomb rule is off by default and appears only as a note in the rules page.
- No Island rule.
- An optional `EVENT_CODE` gate for registration, off by default.
