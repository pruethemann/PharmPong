# PharmaPong: project status (2026-10-24)

- Phases 1–8 complete. Deployed 2026-10-25 to https://web-production-13b1f.up.railway.app (Railway project PharmaPong,
  account peter.ruethemann@stud.unibas.ch; the gmail account's trial is expired). Admin pending until ADMIN_INITIAL_PASSWORD is set.
  railway.json is NOT applied by `railway up`: service settings were set via GraphQL serviceInstanceUpdate.
- Decisions: custom DB sessions instead of Auth.js; e-mail login; Europe/Zurich display; forfeit = 10:0;
  manual knockout start; referees may assign only the scheduler suggestion and may not officiate their own team;
  TIME_LIMIT winner = team with MORE own cups standing.
- Dev infra: Postgres in Docker on :54329 with DBs dev/test/test_a..d/ui_a..d/e2e. `pnpm scenario <mode>` for states.
  Several dev servers can run in parallel: `NEXT_DIST_DIR=.next-x pnpm dev -p 31xx`.
- `prisma migrate reset` is blocked for AI agents (Prisma consent guard); tests use `migrate deploy` + TRUNCATE.
- Node: local 26 works; Railway pinned to 24 via `RAILPACK_NODE_VERSION` (Prisma 7 support).
