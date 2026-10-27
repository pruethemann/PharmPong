# PharmaPong: project status (2026-10-27)

- Phases 1–8 complete. Deployed 2026-10-25 to https://web-production-13b1f.up.railway.app (Railway project PharmaPong,
  account peter.ruethemann@stud.unibas.ch; the gmail account's trial is expired). No admin account yet: after the next deploy create one with
  `railway ssh --service web -- pnpm admin:create --email <e-mail>` (docs/admin-accounts.md) or set ADMIN_INITIAL_PASSWORD.
  railway.json is NOT applied by `railway up`: service settings were set via GraphQL serviceInstanceUpdate.
- Decisions: custom DB sessions instead of Auth.js; e-mail login; Europe/Zurich display; forfeit = 10:0;
  manual knockout start; referees may assign only the scheduler suggestion and may not officiate their own team;
  TIME_LIMIT winner = team with MORE own cups standing.
- Dev infra: Postgres in Docker on :54329 with DBs dev/test/test_a..d/ui_a..d/e2e. `pnpm scenario <mode>` for states.
  Several dev servers can run in parallel: `NEXT_DIST_DIR=.next-x pnpm dev -p 31xx`.
- `prisma migrate reset` is blocked for AI agents (Prisma consent guard); tests use `migrate deploy` + TRUNCATE.
- Node: local 26 works; Railway pinned to 24 via `RAILPACK_NODE_VERSION` (Prisma 7 support).

## v0.2.0 Elo Mode (2026-10-26; merged into `main` and pushed by the user on 2026-10-27; not deployed)

- Built in 8 steps (commits "Elo Mode step 1" … "step 8"); plan and status in `docs/elo-mode/implementation-plan.md`,
  verbatim spec in `claudecode-instructions/elo-spec.md`.
- Decisions: show-and-confirm (the other team confirms the shown result); spec formula kept after the Monte Carlo
  checkpoint (solo play is "high risk, high reward", explained on /rules); staff powers never in an own match,
  admins included; a reported result frees table and players at once; drafts expire lazily after 10 min.
- Railway: local validation only. No Railway change was made; runbook in `docs/deployment.md`
  ("Releasing Elo Mode"). Deploying needs the organizers' explicit go.
- Dev: `pnpm scenario elo` (after the final, 24 matches, live/pending/dispute), `pnpm simulate:elo --fresh`
  (scratch DB only), `pnpm elo:validate` (no DB).
- Dev servers with a new `NEXT_DIST_DIR` rewrite `tsconfig.json` (include list) and the git-ignored
  `next-env.d.ts`; reuse `.next-a/b/c` and restore `next-env.d.ts` to `.next/dev/types/…` afterwards.

## Admin accounts (2026-10-27)

- `pnpm admin:create --email … [--name …] [--promote]` (scripts/create-admin.ts → `createAdminAccount` in
  services/bootstrap.ts): generated one-time password printed once + mustChangePassword; existing accounts only with
  `--promote` (password kept, reactivated, sessions revoked); audited with actor null, reason "CLI".
- On Railway it must run inside the container (`railway ssh`): `railway run` cannot reach `postgres.railway.internal`.
  The other `railway run` examples in docs/deployment.md (export, simulate) have the same limitation.
- Guide: docs/admin-accounts.md. Tests: tests/integration/admin-accounts.int.test.ts (also spawns the real CLI).
