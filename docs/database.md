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

## Concurrency model

Every mutation runs in `withTournamentTx()` (`src/server/services/tx.ts`):

1. `SELECT … FROM "Tournament" … FOR UPDATE`: serializes writers per tournament.
2. Work, using the database clock `now()` captured at lock time.
3. `revision = revision + 1`: the live-sync cursor for polling clients.
4. Commit; retry on serialization failures/deadlocks (40001/40P01).

Optimistic `version` columns on `Match`/`Team` reject stale client writes (`STALE_VERSION`).
Constraint violations are mapped to domain error codes in `src/server/services/pg-errors.ts`.

## Backups & recovery

See [deployment.md](deployment.md).
