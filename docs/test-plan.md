# Test Plan

Three automated layers plus a scripted full-event simulation. Everything except E2E runs with
`pnpm verify` (typecheck, lint, format, unit, integration).

| Layer                                        | Runner               | Location                          | Database                                       | Count                             |
| -------------------------------------------- | -------------------- | --------------------------------- | ---------------------------------------------- | --------------------------------- |
| Unit (pure logic)                            | Vitest `unit`        | `src/**/*.test.ts`                | none                                           | 201 tests / 21 files              |
| Integration (services against real Postgres) | Vitest `integration` | `tests/integration/*.int.test.ts` | `pharmapong_test` (truncated before each test) | 243 tests / 17 files              |
| End-to-end (browser)                         | Playwright           | `tests/e2e/*.spec.ts`             | `pharmapong_e2e` (production build on :3100)   | 101 runs across 3 device projects |

Run:

```bash
pnpm db:up                 # Postgres in Docker (dev, test, e2e databases)
pnpm verify                # typecheck + lint + format + unit + integration
pnpm test:coverage         # unit coverage for src/server/domain (≥ 95% lines; currently ~99.6%)
pnpm test:e2e              # builds and starts the app, then runs all Playwright projects
```

Integration tests may run in parallel against an alternative database:
`DATABASE_URL_TEST=postgresql://…/pharmapong_test_a pnpm test:int`.

## Coverage of the spec (§18)

### Tournament logic

| Requirement                                             | Tests                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| exactly 12 group + 7 knockout matches                   | `draw.test.ts` (fast-check property), `tournament.int.test.ts`                                                                                      |
| correct group assignments (4×3, each pair once)         | `draw.test.ts`, `tournament.int.test.ts`                                                                                                            |
| bracket pairings A1–B2, B1–A2, C1–D2, D1–C2, SF/F links | `bracket.test.ts`, `tournament.int.test.ts`, `full-event.int.test.ts`                                                                               |
| winner advancement only after confirmation              | `results.int.test.ts` (a proposal alone does not fill the next slot)                                                                                |
| cup difference calculations                             | `result-rules.test.ts`, `standings.test.ts`                                                                                                         |
| all ranking tiebreaker scenarios                        | `standings.test.ts`: 6-3-0, cycle separated by diff, by cups for, head-to-head, full three-way tie unresolved, shootout record, stale shootout hash |
| shootout handling (regulation cups only)                | `result-rules.test.ts`, `standings.test.ts`, `full-event.int.test.ts`                                                                               |
| forfeit handling (10:0)                                 | `result-rules.test.ts`, `results.int.test.ts`                                                                                                       |
| no premature qualification                              | `tournament.int.test.ts` (GROUPS_INCOMPLETE, UNRESOLVED_TIE), `standings.test.ts` (qualifiers null until complete)                                  |
| corrections and recovery                                | `corrections.int.test.ts`, `review-fixes.int.test.ts`, `admin.spec.ts` (E2E wizard)                                                                 |

### Authorization

| Requirement                                     | Tests                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| player cannot submit results                    | `matches.int.test.ts` (FORBIDDEN for assign/start/propose)                                                                                                                 |
| referee cannot modify admin settings            | `tournament.int.test.ts` (FORBIDDEN matrix over 15 admin services), `matches.int.test.ts` (forfeit/abort/correct)                                                          |
| admin can correct results                       | `corrections.int.test.ts`                                                                                                                                                  |
| referee cannot officiate their own team         | `review-fixes.int.test.ts`                                                                                                                                                 |
| unauthorized users cannot access protected data | `live.int.test.ts` (401, public snapshot without `@`/codes/hashes), `export.int.test.ts` (401/403), `auth-team.spec.ts` (redirects, `/?forbidden=1`)                       |
| no privilege escalation                         | `auth.int.test.ts` (registration is always PLAYER, profile cannot change role), `users.int.test.ts` (last admin, role checks), `access.test.ts` (password change enforced) |
| brute-force protection                          | `auth.int.test.ts` (5 failures → RATE_LIMITED), `teams.int.test.ts` (invite guessing)                                                                                      |

### Concurrency (`concurrency.int.test.ts`, real parallel transactions)

- 5 referees confirm the same match: exactly 1 succeeds, the others get `STALE_VERSION`, the next slot is filled once, and the revision goes up by 1.
- The same idempotency key sent 5× in parallel: 1 mutation and 5 identical responses. A different payload with the same key: `IDEMPOTENCY_MISMATCH`.
- Two matches assigned to one table: `TABLE_BUSY`. One team assigned to two tables: `TEAM_BUSY`.
- Stale versions are rejected. An injected failure rolls back all writes and leaves the revision unchanged (`constraints.int.test.ts`).
- After each test the invariants are asserted: no team in two active matches, no table with two active matches, and lock rows equal to 2× the active matches.
- Two users racing for the last team slot, and one user racing to join two teams: `teams.int.test.ts`.
- Raw constraint violations: `constraints.int.test.ts`, `schema-invariants.int.test.ts`.

### UI (Playwright: desktop 1280×800, Pixel 7, iPhone 14 viewport)

| Spec                   | Covers                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-team.spec.ts`    | registration, creating a team, invite link via clipboard, second user joins, German login error, protected redirects                           |
| `referee-flow.spec.ts` | assign → start → timer → enter → server-stored review → press-and-hold confirm → success. A second browser updates without reload.             |
| `display.spec.ts`      | public display logged out, no e-mail addresses, disabling it returns 404 and the disabled screen, champion takeover (also with reduced motion) |
| `reconnect.spec.ts`    | blocked `/api/live*` → "Verbinde neu …" / "Offline" and critical buttons disabled → recovery to "Live"                                         |
| `admin.spec.ts`        | correction blocked by a started semifinal → recovery wizard with typed confirmation → bracket consistent                                       |
| `mobile.spec.ts`       | 13 pages: no horizontal overflow, buttons and tabs ≥ 44px                                                                                      |
| `a11y.spec.ts`         | axe: no critical/serious violations on 17 pages (public, referee, admin)                                                                       |

### Full event simulation (`full-event.int.test.ts`, `pnpm simulate`)

24 participants and 12 teams play all 19 matches through the real services, with both tables running concurrently:

- group A forced into a full three-way tie, so the knockout start is blocked until the ranking shootout is recorded;
- a SHOOTOUT result and a TIME_LIMIT result;
- a QF result corrected before its SF started (the slot propagates);
- an attempted correction after the SF started, which fails with `DOWNSTREAM_STARTED`;
- the final crowns the champion.

The test then verifies:

- 19 decided matches, tournament COMPLETED, champion = winner of F;
- standings recomputed from raw rows equal the expected tables;
- the bracket is consistent (QF = qualifiers, SF/F = feeder winners);
- no leftover lock rows, an audit row for every propose/confirm/correction, and the public snapshot shows the champion.

## Manual checks before the event

1. Run `pnpm scenario groups` on staging, then do a referee flow on two real phones at once (both tables).
2. Put `/display` on the projector (1080p) and read it from about 5 m away. Check the champion screen with `pnpm scenario completed`.
3. Turn wifi off on a phone during a match: the badge shows "Offline" and confirm is disabled. Reconnect and check that the result is either visible or still pending, never doubled.
4. Admin: run a correction and the recovery wizard once on staging.
5. Check that a restore from a Postgres backup works (see `deployment.md`).
