# Database

PostgreSQL 17, accessed via Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg` driver adapter).
Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`. All timestamps are stored in UTC
(`timestamp(3)`), displayed in Europe/Zurich.

## Integrity constraints (raw SQL)

`prisma/migrations/20261024081200_constraints/migration.sql` adds constraints Prisma cannot express.
They are asserted by `tests/integration/schema-invariants.int.test.ts`.

| Constraint                                                  | Guarantees                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `tournament_one_open`                                       | at most one non-finished tournament                                            |
| `team_member_active_user`                                   | a user is active in at most one team                                           |
| `team_member_active_slot` + `team_member_slot_chk`          | a team has at most two active members                                          |
| `match_one_active_per_table`                                | a table hosts at most one ASSIGNED / IN_PROGRESS / AWAITING_CONFIRMATION match |
| `ActiveTeamMatch` primary key                               | a team is in at most one active match                                          |
| `match_cups_chk`                                            | remaining cups 0–10                                                            |
| `match_winner_chk`                                          | winner is one of the two teams                                                 |
| `match_done_has_result_chk`                                 | completed/forfeited matches have a confirmed result                            |
| `match_active_has_table_chk` / `match_active_has_teams_chk` | active matches have a table and both teams                                     |
| `group_tiebreak_active`                                     | one live tiebreak decision per tie basis                                       |

**Never accept a generated migration that drops these.** Review `prisma migrate dev` output.

### Elo Mode (`prisma/migrations/20261026090100_elo_constraints/migration.sql`)

| Constraint                                                                                | Guarantees                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `elo_session_single_open`                                                                 | at most one non-closed Elo session per tournament (event)                             |
| `elo_table_one_live_match`                                                                | a table hosts at most one DRAFT / IN_PROGRESS Elo match                               |
| `EloActivePlayer` primary key                                                             | a player is in at most one live Elo match (mirrors `ActiveTeamMatch`)                 |
| `elo_run_single_active`                                                                   | exactly one active (not superseded) rating run per session                            |
| `elo_session_settings_chk` / `elo_run_params_chk`                                         | team sizes 1–4, champion minimum, reminder; K, D, start rating, multipliers in [0, 1] |
| `elo_participant_position_chk` + unique `(matchId, side, position)`, `(matchId, userId)`  | 1–4 players per side, nobody twice or on both sides                                   |
| `elo_match_consent_chk`                                                                   | leaving the draft requires both sides' consent to the current roster hash             |
| `elo_match_started_chk`, `_result_chk`, `_completed_chk`, `_pending_chk`, `_disputed_chk` | every status carries the fields it needs (start, winner, sequence, submission, …)     |
| `elo_match_cups_chk`, `_clock_chk`, `_rating_chk`                                         | cups 0–10, paused only while running, multiplier/expectation in [0, 1], versions ≥ 0  |
| unique `(sessionId, confirmedSequence)`                                                   | the confirmation sequence is unique per session                                       |
| `elo_player_rating_chk`, `elo_rating_change_chk`                                          | finite ratings (also rejects NaN/±Infinity), wins + losses = games                    |
| `elo_revision_roster_chk`, `elo_revision_result_chk`                                      | immutable result revisions have valid rosters and a winner unless voided              |

`Tournament.gameMode` (default `COMPETITIVE`) selects the active mode of the event. Constraint names are
mapped to error codes in `src/server/services/pg-errors.ts` (`TABLE_BUSY`, `PLAYER_BUSY`, `INVALID_STATE`);
they must not contain an existing constraint name as a substring, because the mapping uses `includes`.

**CHECK constraints pass when they evaluate to NULL.** Guard nullable columns explicitly
(`x IS NOT NULL AND x = y`). Prisma creates scalar-list columns (`String[]`, `Float[]`) as **nullable**
arrays, so array checks also test `IS NOT NULL` and `array_position(arr, NULL) IS NULL`.

## Elo Mode tables

| Table                    | Role                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `EloSession`             | one per event round: status (OPEN / PAUSED / CLOSED), non-rating settings, next sequence    |
| `EloRatingRun`           | rating parameters (K, D, start, multipliers) + algorithm version of one calculation run     |
| `EloMatch`               | spontaneous match: table, status, consent hashes, stopwatch, current result, sequence       |
| `EloMatchParticipant`    | the temporary roster (side, position); immutable after the start                            |
| `EloActivePlayer`        | lock row per player in a live match                                                         |
| `EloPlayerRating`        | current projection of the active run (rebuilt by every replay)                              |
| `EloRatingChange`        | per run, per match, per player: before, Δ, after, expectation, team sizes, multiplier       |
| `EloMatchResultRevision` | immutable history of every result-defining step (submitted, confirmed, corrected, voided …) |
| `EloMatchEvent`          | match timeline (created, consented, started, paused, …)                                     |

## Creating migrations

`prisma migrate dev` refuses to run non-interactively (and `migrate reset` is blocked for AI agents), so
migrations are generated from a schema-to-schema diff, which needs no shadow database:

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema.before.prisma
pnpm prisma migrate diff --from-schema /tmp/schema.before.prisma --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/<timestamp>_<name>/migration.sql
grep -nE 'DROP|ALTER TYPE' prisma/migrations/<timestamp>_<name>/migration.sql   # must be empty
# raw-SQL constraints go into a separate, hand-written <timestamp>_<name>_constraints migration
pnpm db:deploy && pnpm prisma generate
pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # 0 = no drift
```

The Elo migrations were verified on an empty database and on a database holding a completed competitive
tournament (all row counts unchanged, every tournament `COMPETITIVE`). The previous release's
`prisma migrate deploy` reports "No pending migrations" against the new schema, so rolling back the app
does not require a database rollback.

## Concurrency model

Every mutation runs in `withTournamentTx()` (`src/server/services/tx.ts`):

1. `SELECT … FROM "Tournament" … FOR UPDATE`: serializes writers per tournament.
2. Work, using the database clock `now()` captured at lock time.
3. `revision = revision + 1`: the live-sync cursor for polling clients.
4. Commit; retry on serialization failures/deadlocks (40001/40P01).

Optimistic `version` columns on `Match`/`Team` reject stale client writes (`STALE_VERSION`).
Constraint violations are mapped to domain error codes in `src/server/services/pg-errors.ts`.

Elo Mode uses the same lock through `withEloTx` (`src/server/services/elo-core.ts`), which also cancels
expired drafts lazily before every Elo write. `EloMatch.version`, `EloMatch.resultVersion` and
`EloSession.configVersion` reject stale writes; consent carries the roster hash the player saw
(`ROSTER_CHANGED` otherwise); result steps and corrections are idempotent (`IdempotencyKey`, scopes `elo.*`).
Confirmation order comes from `EloSession.nextSequence`, taken under the lock, never from timestamps.

## Backups & recovery

See [deployment.md](deployment.md).
