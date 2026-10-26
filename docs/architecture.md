# Architecture

PharmaPong is a **modular monolith**: one Next.js 16 application (App Router) backed by one
PostgreSQL database and one S3-compatible bucket. There is no Redis, no queue and no websocket server.
Near-real-time updates come from cheap revision polling.

```
┌──────────── Browser (phone, laptop, projector) ────────────┐
│ Server-rendered pages + client islands                      │
│ useLive(): GET /api/live?since=<rev> every 2.5 s            │
│ Server Actions for every mutation (POST, Origin-checked)    │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼──────────── Next.js (Railway service) ──────┐
│ src/app/**            routes, pages, route handlers          │
│ src/server/actions/*  "use server": Zod + role + error map   │
│ src/server/services/* transactional use cases (+ assertRole) │
│ src/server/domain/*   PURE rules (no DB / framework)         │
│ src/server/auth/*     sessions, argon2id, throttling         │
│ src/server/storage/*  memory | S3 driver for team logos      │
└───────┬───────────────────────────────┬─────────────────────┘
        │ Prisma 7 + @prisma/adapter-pg │ @aws-sdk/client-s3
┌───────▼────────┐              ┌───────▼────────┐
│ PostgreSQL 17  │              │ Railway Bucket │
└────────────────┘              └────────────────┘
```

## Layers

| Layer    | Folder                | Rules                                                                                                                                                                                                                                                                        |
| -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain   | `src/server/domain`   | Pure TypeScript. State machines (`tournament-state`, `match-state`), secure draw, bracket template and slot resolution, result validation, standings and tiebreaks, scheduler, timer. An ESLint rule forbids importing Prisma, Next or React here. ≥ 95% unit-test coverage. |
| Services | `src/server/services` | One function per use case, signature `(actor, input, opts?)`. Each calls `assertRole` (defense in depth), runs inside `withTournamentTx`, validates transitions with the domain, writes `AuditLog` (+ `MatchEvent` for matches), and throws `DomainError(code)`.             |
| Actions  | `src/server/actions`  | Thin `"use server"` wrappers built with `defineAction({schema, access, handler})`: Zod parsing, role gate, `mustChangePassword` gate, mapping `DomainError` to German messages, returning `ActionResult`.                                                                    |
| Routes   | `src/app`             | Pages call `requirePageUser(role)`. Route handlers: `/api/health`, `/api/live`, `/api/live/public`, `/api/logos/[teamId]`, `/api/admin/export`, plus Elo Mode `/api/mode`, `/api/elo/live`, `/api/elo/live/public`, `/api/admin/elo-export`.                                 |
| UI       | `src/components`      | `ui/` is shadcn (Base UI). `pp/` holds the design-system primitives. Feature folders: `auth/`, `team/`, `referee/`, `match/`, `live/`, `bracket/`, `standings/`, `display/`, `admin/`.                                                                                       |

## Consistency and concurrency

- **Per-tournament serialization.** `withTournamentTx` (`src/server/services/tx.ts`) locks the tournament row with `SELECT … FOR UPDATE`. That serializes every write of a tournament: 24 users generate no meaningful contention, and race conditions disappear by construction.
- **Second line of defense.** Postgres constraints back this up (see [database.md](database.md)):
  - a partial unique index for one active match per table;
  - `ActiveTeamMatch(teamId PK)` for one active match per team;
  - partial unique indexes for team membership;
  - CHECK constraints on results.
- **Optimistic concurrency.** `Match.version` and `Team.version` reject stale UI state with `STALE_VERSION`. The UI reloads the snapshot and shows what changed.
- **Idempotency.** Referee result submissions carry a client-generated key, stored in `IdempotencyKey` in the same transaction. Retries after a network loss replay the original response. A concurrent duplicate waits on the primary key and then replays.
- **Server clock.** All timestamps come from the database `now()` captured at lock time. Clients receive `serverNow` with every poll and keep a clock offset, so every phone and the projector show the same countdown.
- **No success before commit.** Actions return `ok` only after the transaction has committed. The UI never shows optimistic success for critical writes, and it disables critical buttons while offline.

## Live synchronization

Every committed mutation increments `Tournament.revision`. Clients poll `GET /api/live?since=<rev>`:

1. **Fast path.** A one-row query reads `revision`. If it equals `since`, the reply is `{unchanged:true, revision, serverNow}` (a few bytes).
2. **Changed.** The full snapshot is built from one `REPEATABLE READ` transaction, so the data matches the revision. The public snapshot is memoized per revision in process memory.

Public and authenticated snapshots are separate shapes (`src/lib/live-types.ts`):

| Snapshot                     | Contains                                                                              | Never contains                       |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| Public (`/api/live/public`)  | team names, mottos, logos, member display names                                       | e-mails, invite codes, internal data |
| Authenticated                | the public data plus `me` and `myNextMatchId`                                         |                                      |
| Authenticated, referee/admin | per-match `version` / `resultRevision` / proposal / open issue, scheduler suggestions |                                      |
| Authenticated, admin         | unresolved ties, pending confirmations                                                |                                      |

`useLive` (`src/lib/use-live.ts`):

- pauses polling in hidden tabs and refetches on focus or reconnect;
- backs off exponentially on errors;
- exposes `online | reconnecting | offline`, shown by `ConnectionBadge`.

## Authentication

Custom database sessions (the spec allows "an equivalent secure implementation"). Auth.js credentials would force JWTs, which delay role changes and deactivation.

| Aspect        | Implementation                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token storage | 32-byte random token in the `pp_session` cookie (HttpOnly, Secure on https, SameSite=Lax, 14 days, sliding). The database stores only `sha256(token)`.                          |
| Freshness     | The user's role and active flag are read on every request, so demotion and deactivation apply immediately. Password change, reset and deactivation also revoke sessions.        |
| Passwords     | Argon2id (`@node-rs/argon2`, m=19 MiB, t=2). Unknown e-mails run a dummy verify, so timing does not reveal accounts.                                                            |
| Brute force   | `AuthThrottle` (atomic upsert): 5 failed logins per e-mail per 15 min, loose per-IP limits (venue NAT), plus limits on registration, invite-code guessing and reset redemption. |
| Recovery      | Admin-generated one-time reset links (30 min). Break-glass CLI: `scripts/reset-admin-password.ts`.                                                                              |
| Initial admin | Created from `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` by `scripts/seed-admin.ts` during pre-deploy. It must change the password on first login.                                 |
| Registration  | Always creates a `PLAYER`. Roles are never read from input.                                                                                                                     |
| Proxy         | `src/proxy.ts` only redirects missing cookies on protected paths. Real checks happen in pages, actions and services.                                                            |

## Tournament flow

```
DRAFT → REGISTRATION_OPEN → REGISTRATION_LOCKED ─(generateDraw)→ GROUP_STAGE ─(startKnockout)→ KNOCKOUT_STAGE → COMPLETED
                                   ↑ resetDraw (typed confirmation, full snapshot in AuditLog)        ↑ recovery only
any non-terminal ──cancel──► CANCELLED          PAUSED = flag (isPaused) during play
```

Match lifecycle:

```
PENDING → READY → ASSIGNED → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED
                    ↑ unassign     ↑ reject proposal                 (advance winner, champion)
READY/ASSIGNED/IN_PROGRESS/AWAITING → FORFEITED (admin) · abort (admin) → READY
```

**Corrections.** A correction recomputes the expected knockout slots (`bracket.expectedKnockoutSlots`):

- If an affected downstream match has not started, the correction propagates automatically.
- Otherwise the service raises `DOWNSTREAM_STARTED`, and only the audited recovery workflow (`executeRecovery`, typed confirmation) can void the affected chain.

## Elo Mode

A second, independent game mode for the social part of the event. Same stack, same layers, same consistency
model; it shares the tournament row (event), the two `GameTable` rows and the users with the tournament
mode, and nothing else. Design and decisions: [elo-mode/implementation-plan.md](elo-mode/implementation-plan.md).

- **Mode.** `Tournament.gameMode` (`COMPETITIVE` | `ELO`) is read under the tournament lock
  (`LockedTournament.gameMode`, `assertGameMode`). Competitive writes refuse in Elo Mode (`WRONG_MODE`) and
  vice versa; the switch (`setGameMode`) is refused while the current mode has open matches. `ModeWatch`
  (client) polls `/api/mode` every 10 s and refreshes server-rendered pages after a switch.
- **Domain** (`src/server/domain/elo/`, pure, ≥ 95 % coverage): `RatingEngine` interface with `PHARMA_ELO_V1`,
  preview, repeat-match rule, deterministic `replaySession` (a fold of `applyMatch`), ranking with exact ties,
  achievements, roster validation, match state machine and the permission matrix (`eloActionDenial`) that the
  services enforce and the snapshot sends as UI hints.
- **Services** (`src/server/services/elo-*.ts`): every Elo write runs in `withEloTx` (tournament lock, lazy
  expiry of 10-minute drafts, revision bump). Locks: partial unique index for one live match per table,
  `EloActivePlayer` (user PK) for one live match per player; both are released by the first result report.
  Consent is bound to `rosterHash`; result steps are idempotent (`runIdempotent`) and version-checked.
- **Ratings.** A confirmation takes the next sequence number and appends its step to the active
  `EloRatingRun`. Corrections, voids of completed matches, parameter changes and manual recalculation replay
  the whole session into a new run (the old run stays as history). The dry run (`verifyRatings`) compares the
  stored projection with a fresh replay.
- **Live.** `/api/elo/live` (signed in) and `/api/elo/live/public` (only with the public display on) follow
  the `/api/live` contract (revision fast path, `REPEATABLE READ` snapshot, per-revision memo). Elo pages use
  `EloLiveProvider` around the same `useLive` hook. Public snapshots contain display names and ratings only;
  the player list for the match builder is part of the signed-in extras.
- **UI** (`src/components/elo`, `src/components/admin/elo`): home/arena, match builder and picker, match page
  per state, referee board, rankings, profile with SVG chart, QR landing, projector view, admin page.

```
Elo match: DRAFT ─(both consents = rosterHash, start)→ IN_PROGRESS ─(report)→ AWAITING_CONFIRMATION ─(confirm)→ COMPLETED
           │ cancel / leave / expiry                   │ staff abandon      │ dispute → DISPUTED ─(staff)→ COMPLETED
           ▼                                           ▼                    │ staff void ↓                   │ admin correct ↻
       CANCELLED                                   CANCELLED                VOIDED  ←──── admin void ───────┘
```

## Files worth knowing

| File                                   | Why                                                          |
| -------------------------------------- | ------------------------------------------------------------ |
| `src/server/services/tx.ts`            | lock, revision bump, retry                                   |
| `src/server/services/state.ts`         | loads a tournament into domain views (standings, qualifiers) |
| `src/server/services/results.ts`       | propose, confirm, advance, champion                          |
| `src/server/services/corrections.ts`   | correction and recovery                                      |
| `src/server/domain/standings.ts`       | ranking rules                                                |
| `src/server/services/live-snapshot.ts` | polling API                                                  |
| `scripts/dev-scenario.ts`              | realistic data states for development and demos              |
| `src/server/services/elo-core.ts`      | Elo transaction, locks, draft expiry, match loading          |
| `src/server/services/elo-ratings.ts`   | confirmation step, replay into a new run, dry run            |
| `src/server/domain/elo/replay.ts`      | the one deterministic rating code path                       |
| `src/server/sim/simulate-elo-event.ts` | a whole Elo evening through the services (`simulate:elo`)    |
