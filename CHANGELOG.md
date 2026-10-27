# Changelog

All notable changes to PharmaPong. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `pnpm admin:create --email <e-mail> [--name …] [--promote]`: creates an admin account with a one-time
  password (shown once, must be changed at the first login) or, with `--promote`, makes an existing account an
  admin without touching its password. Audited; runs on Railway through `railway ssh`. Step-by-step guide in
  [docs/admin-accounts.md](docs/admin-accounts.md).

## [0.2.0] - 2026-10-26

Social **Elo Mode** for the apéro after the tournament. The tournament mode is unchanged; all database changes
are additive (new tables, new enums, two new columns with defaults on `Tournament`).

### Added

- **Game mode** per event (`Tournament.gameMode`: tournament or Elo), switched by the admin on `/admin`.
  Switching is refused while the current mode has open matches (the blocking matches are listed); every open
  page follows a switch within about 10 seconds. Tournament data stays untouched in Elo Mode and vice versa.
- **Elo rounds** (sessions): open, pause, close with champion(s) (typed confirmation), reopen with reason.
  Everybody starts at 100 Elo; at least 3 rated games for the title ("vorläufig" below that).
- **PharmaElo v1 rating engine** (pure, deterministic): team rating = average, expected score with scale
  D = 100, K = 24 per team, the change split equally within a team, zero-sum, no rounding, repeat-match
  multipliers 100/100/50/0 %, friendlies. Full replay in confirmation order with calculation runs as history.
  Monte Carlo validation (`pnpm elo:validate`) and a database-level event simulation (`pnpm simulate:elo`).
- **Matches with temporary teams** of 1–4 players on the two tables: match builder with player search and
  live preview (win probability, Elo per person for both outcomes, repeat and solo hints), consent of the
  other team on its own phone (bound to the exact roster), count-up stopwatch with pause and an optional soft
  reminder, two-step result entry, confirmation or dispute by the other team, celebration with the Elo
  changes. Drafts expire after 10 minutes without a cron job.
- **Referees** (`/elo/referee`): in-person consent, deciding running matches and disputes (reason required),
  voiding pending results, abandoning running matches; never in a match they play themselves.
- **Admin** (`/admin/elo`): KPIs, dispute queue, corrections of any completed match (winner, end type,
  rated flag, roster) with replay, voiding completed matches, "Prüfen" dry run, manual recalculation,
  calculation-run history, settings and rating parameters, public display toggle, export (JSON/CSV),
  printable table QR codes (`/print/elo-qr`). All actions audited with German labels.
- **Pages**: Elo home (arena, my to-dos, top 5, recent results, achievements), leaderboard, player profile
  with an accessible SVG rating chart, QR landing page per table, Elo house rules on `/rules`, Elo projector
  view with champion finale on `/display`.
- **Achievements** (no effect on Elo): most active, biggest upset, best comeback.
- `pnpm scenario elo` dev data; integration tests for the services, constraints, concurrency, idempotency,
  replays and a full event; Playwright tests for two-player matches, referee and admin flows, the live mode
  switch, axe scans and phone layout of the Elo pages.

### Changed

- The admin overview's public-display switch uses `setPublicDisplay`, which also works after the final.
- `/referee` redirects to `/elo/referee` while Elo Mode runs; tournament pages show an Elo Mode banner.
- Pre-deploy (`seed-admin`) keeps an event that is in Elo Mode or has an open Elo round instead of starting
  a new tournament (`ensureTournamentForDeploy`).

## [0.1.0] - 2026-10-25

First release, deployed to Railway.

### Added

- Accounts with e-mail login, argon2id, database sessions, login throttling, roles (player, referee, admin)
  and password reset links.
- Teams of two with invitations and logos (S3 bucket), 12 teams in 4 groups, seeded draw.
- Tournament lifecycle: registration, draw, group stage, ranking shootouts for ties, knockout (quarterfinals
  to final), forfeits, pause, completion with champion.
- Referee mode: table assignment with scheduler suggestions, 15-minute countdown, two-step result entry,
  corrections and recovery tools for admins, full audit log.
- Live dashboard, tournament view with bracket, match details, projector display, rules page, design system
  "midnight lab" (dark, German, mobile-first).
- Exports, demo data, dev scenarios, a full 19-match event simulation, unit, integration and E2E tests.
