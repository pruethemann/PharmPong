# PharmaPong 2.0 — Social Elo Mode: Implementation Plan

> **Status (living document):** Steps 1–2 done (rating engine, tests, simulation report; checkpoint passed
> 2026-10-26: spec formula kept, solo risk explained in the rules) · Steps 3–4 (database, backend) done · Step 5
> (core UI) in progress.
> Verbatim spec: [`claudecode-instructions/elo-spec.md`](../../claudecode-instructions/elo-spec.md).
> Rating math: [rating-system.md](rating-system.md) · Validation: [rating-validation.md](rating-validation.md).

## Context

PharmaPong (`/Users/husedo15/code/PharmaPong`, branch `elo`, clean tree, v0.1.0) is a deployed, working
competitive Beer Pong tournament app (fixed 2-player teams, groups, knockout, referees, 15-min countdown).
The product owner wants a second, independent **Elo Mode** for the social apéro part of the event:

- spontaneous matches on the two tables, with temporary 1–4-player teams;
- a count-up stopwatch;
- individual session-scoped Elo starting at 100;
- team-based result confirmation;
- a live leaderboard and a mode-aware public display.

The competitive mode must keep working unchanged, and every migration is additive. The full spec is the pasted
"CODEX MASTER INSTRUCTION". Step 1 saves it verbatim.

**User decisions (this session)**

- Execution: **Opus, single agent**, phase by phase.
  - One commit per verified phase on branch `elo`; nothing is pushed.
  - The CLAUDE.md §3a Opus warning is shown first, and execution starts only after an explicit `yes`.
- Dual-team confirmation = **show and confirm**: the opposing representative sees the submitted winner and taps
  _Bestätigen_ or _Einspruch_.
- **Local validation only**: no Railway writes. Deliver a deploy, backup and rollback runbook instead.
- **Checkpoint**: stop after Step 2 (rating engine, tests, simulation report) for the user's review.

**Decisions I made (open to objection at approval)**

- A submitted result releases the table and players immediately; only the confirmation is still pending.
- Staff powers (final result, resolving disputes, voiding, override, abandoning) never apply to a match the staff
  member plays in, **admins included**. This differs from the competitive admin exemption in `assertNotOwnMatch`
  (`src/server/services/matches.ts:78-94`), because the spec says nobody may confirm for both teams.
- Admin corrections of a completed match remain possible on any match. They require a reason, are audited, and
  are marked "eigenes Spiel" when the admin played in it.
- Negative ratings are shown as they are, with no floor.

**Repo notes**

- `graphify-out/` does not exist (optionally run `graphify --update`). There is no `CHANGELOG.md`.
- `AGENTS.md`: read `node_modules/next/dist/docs/` before writing Next.js code.
- Dev infrastructure:
  - Docker Postgres on :54329 with dev, test and e2e databases.
  - `pnpm scenario <mode>`.
  - `prisma migrate reset` is blocked for agents, and `migrate dev` refuses non-interactive runs, so use
    `migrate deploy` plus TRUNCATE.

## Architecture decisions

### A1. Anchor: the tournament row is the event (confirmed by the independent design review)

- **Mode:** `Tournament.gameMode GameMode @default(COMPETITIVE)` plus `gameModeChangedAt`.
- **Sessions:** `EloSession` belongs to the tournament. At most one non-CLOSED session per tournament; older
  CLOSED sessions are kept as history. A future event, i.e. a new tournament, starts with independent rankings.
- **Locking:** every Elo write uses `withTournamentTx` (`src/server/services/tx.ts:34`).
  - The `FOR UPDATE` statement (`tx.ts:46-48`) also selects `"gameMode"` (`LockedTournament`, `tx.ts:6-12`),
    so every mode check reads the latest committed value without an extra statement.
  - One row lock serializes the mode switch, Elo writes, rating replays and competitive writes.
  - The same transaction provides the DB clock `ctx.now` and the `revision` bump.
  - This is the spec's "session-level lock or equivalent".
- **Elo tables:** Elo matches reference the tournament's existing `GameTable` rows, so renaming and disabling
  apply to both modes.
- **Pre-deploy hazard:** Railway pre-deploy runs `scripts/seed-admin.ts:8` → `ensureTournament()`
  (`bootstrap.ts:7`), which creates a new tournament whenever none is open. The apéro runs _after_ the final
  (tournament COMPLETED), so a hotfix deploy would make a new COMPETITIVE tournament current. That would strand
  the Elo session, and the global player locks would block players.
  - Fix: a new `ensureTournamentForDeploy()`, used only by `seed-admin.ts`, that keeps the latest tournament while
    it is in ELO mode or has a non-closed session, and logs why.
  - `ensureTournament()` stays unchanged for sims and tests.
  - Plus a deploy-freeze note in the runbook.

### A2. Mode gating and impact on existing code (minimal, additive guards)

| Where                                                                                                    | Change                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx.ts:6-12, 46-48`                                                                                      | Select `gameMode`; add the helper `assertGameMode(ctx, mode)` → new code `WRONG_MODE`                                                                                                               |
| `assignMatch` (`matches.ts:192`, the only way into an active status) and `startMatch` (`matches.ts:330`) | `assertGameMode(ctx,"COMPETITIVE")` next to `assertPlayPhase`; occupancy check also rejects a table with a live Elo match                                                                           |
| `live-snapshot.ts:383, :388`                                                                             | Empty `suggestions` in ELO mode. Add a top-level `gameMode` to `PublicSnapshot`. The `unchanged` and `admin` shapes stay as they are; they are asserted exactly in `live.int.test.ts:294, 341, 410` |
| `setTableDisabled` (`tables.ts:33`)                                                                      | Also TABLE_BUSY for a live Elo match. Drafts are swept first.                                                                                                                                       |
| `pauseTournament` (`tournament.ts:715`)                                                                  | WRONG_MODE in ELO mode (Elo pauses per match). `resumeTournament` is unchanged.                                                                                                                     |
| `tournament.ts:263` (`updateSettings` refuses COMPLETED/CANCELLED)                                       | Unchanged. New service `setPublicDisplay` works in any status, so the display can be enabled for Elo after the final.                                                                               |
| `pg-errors.ts:5-13`                                                                                      | Map `elo_table_one_live_match` → TABLE_BUSY, `EloActivePlayer_pkey` → PLAYER_BUSY, `elo_session_single_open` → INVALID_STATE. The names must not contain existing keys (matching uses `includes`).  |
| `errors.ts`, `de.ts:74`, `define-action.ts:12-29`                                                        | New codes WRONG_MODE, PLAYER_BUSY, SESSION_NOT_OPEN, MODE_SWITCH_BLOCKED, ROSTER_CHANGED with German messages                                                                                       |
| `admin-read.ts:71-109`, `src/lib/admin-labels.ts`                                                        | Labels for `elo.*` audit actions and the EloMatch/EloSession entities                                                                                                                               |
| `seed-admin.ts`, `bootstrap.ts`                                                                          | `ensureTournamentForDeploy` (A1)                                                                                                                                                                    |
| `scripts/dev-scenario.ts:77-90` (`freshTournament`)                                                      | Also cancel live Elo matches, release locks, close sessions                                                                                                                                         |
| `src/server/sim/simulate-tournament.ts:79`                                                               | Move `seededRng` to the pure `src/server/domain/rng.ts` and re-export it (API unchanged)                                                                                                            |
| `src/lib/result-form.ts:198`                                                                             | Extend the `IdempotencyStep` union with the Elo steps                                                                                                                                               |
| `app-nav.tsx:11`, `(app)/layout.tsx:8`                                                                   | `navItems(role, gameMode)`                                                                                                                                                                          |
| `(app)/page.tsx`, `/display`, `/referee`, `/tournament`, `/admin/*`                                      | ELO branches or banners (A9)                                                                                                                                                                        |

- Cancel, draw, reset, knockout, forfeit and correction only touch competitive tables. They stay allowed in ELO
  mode, and the danger-zone text notes that Elo data is kept.
- `setGameMode` (ADMIN, under the lock) returns the blockers when it refuses:
  - Competitive blockers: matches in ASSIGNED, IN_PROGRESS or AWAITING_CONFIRMATION.
  - Elo blockers: matches in DRAFT, IN_PROGRESS, AWAITING_CONFIRMATION or DISPUTED.
  - "Offene Entwürfe abbrechen" is an explicit admin action.
  - The first switch to ELO opens a session (with run #1 holding the default parameters).
  - Switching back reuses the non-closed session, so the leaderboard returns.

### A3. Live sync

- **Endpoints:** `/api/elo/live` (authenticated) and `/api/elo/live/public` (404 unless `publicDisplayEnabled`).
  - They reuse `readLiveHead` (`live-snapshot.ts:48`) on the shared `Tournament.revision`, the `LiveResponse<T>`
    contract, a read-only REPEATABLE READ snapshot, and the per-revision memo of the public part.
  - Idempotent replays set `ctx.dirty=false`, like `results.ts:173`.
- **Consumers:** Elo pages use the unchanged generic `useLive({endpoint})` (`src/lib/use-live.ts`). Each mode is
  mounted as its own component (`key={gameMode}`), because `useLive` does not reset when its endpoint changes.
- **`ModeWatch`:** a client component in `(app)/layout.tsx` and the display layout.
  - It polls `/api/mode` (`{gameMode}`, public, a few bytes) every 10 s and pauses while the tab is hidden.
  - On a mismatch with the server-rendered mode it calls `router.refresh()`, so every client follows a switch
    within 10 s, including pages that don't poll. `useLive` itself stays untouched.
- **Server reader:** `getActiveGameMode()` (wrapped in `cache()`, `src/server/services/game-mode.ts`).
- **Privacy:**
  - The public Elo snapshot carries display names, ratings and results only.
  - The player picker list (all active users, no e-mails) is in the authenticated extras only.
  - Per-role snapshot tests check this.

### A4. Pure PharmaElo domain: `src/server/domain/elo/`

- The ESLint purity rule and the coverage `include` already cover the folder.
- Client code may import it; `big-timer.tsx` already imports `domain/timer`.
- The server always recomputes from DB state and never trusts client ratings.

| File                                                                                 | Content                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`, `config.ts`                                                              | `Side`, `EloParams`, `DEFAULT_ELO_CONFIG` (spec values), `validateEloConfig`                                                                           |
| `engine.ts`                                                                          | `interface RatingEngine { version; calculate(input): RatingResult }`, `PHARMA_ELO_V1`                                                                  |
| `preview.ts`                                                                         | `previewMatchup`: team averages, win probabilities, ±Δ per side for both outcomes                                                                      |
| `repeat.ts`                                                                          | `rosterPairKey` (ids sorted within each side, then the two sides sorted, so swapping A/B gives the same key), `multiplierFor(priorCount, multipliers)` |
| `replay.ts`                                                                          | `applyMatch(state, entry, params, engine)`, `replaySession` (a fold of `applyMatch`), `projectionDigest`                                               |
| `ranking.ts`, `achievements.ts`                                                      | ranking, provisional/eligible flags, `championsOf`; the three achievements                                                                             |
| `roster.ts`, `match-state.ts`, `permissions.ts`, `result-rules.ts`, `table-state.ts` | validation, the transition table, the per-viewer `can` matrix (used by services _and_ as snapshot UI hints)                                            |
| `src/server/domain/timer.ts`                                                         | add `formatElapsed(ms)` (rounds down, `h:mm:ss` from one hour). `computeTimer` already returns `elapsedMs` and is unchanged.                           |

**Engine (pharmaelo-v1)**

- Team rating is the mean of the side's ratings, summed in canonical ascending order. That makes it
  bit-identical under any roster permutation.
- `E_A = 1/(1+10^((R_B−R_A)/D))`, `E_B = 1−E_A`.
- Transfer: `Δ_A = K·(S_A−E_A)·multiplier`. Each A player gets `Δ_A/n_A`, computed once per side; each B player
  gets `−Δ_A/n_B`.
- No rounding, no floors, no ceilings.
- `VALIDATION` errors (with German messages) for:
  - an empty side, or more than 4 players on a side;
  - a duplicate player, within one side or across both;
  - non-finite numbers, `K ≤ 0`, `D ≤ 0`, or a multiplier outside [0, 1].
- Cups are not an input. The configurable size limits live in `roster.ts`.
- Zero-sum holds within about 1e-12; tests use a tolerance.

**Config bounds**

- K in (0, 100], D 10–1000, initial rating 0–10000.
- Team size 1 ≤ min ≤ max ≤ 4.
- minGamesForChampion 0–100; reminder null (off) or 1–240 min.
- Multipliers: 1–10 values, each in [0, 1]. The admin turns the repeat-match rule off by setting the multipliers
  to `[1]`.

### A5. Data model (additive, Elo-prefixed; adapts the spec's suggested names)

- **Enums (new only, never `ALTER TYPE`):**
  - `GameMode`
  - `EloSessionStatus {OPEN PAUSED CLOSED}`
  - `EloSide {A B}`
  - `EloResultPolicy {DUAL_TEAM_CONFIRMATION REFEREE_ONLY}`
  - `EloEndType {REGULAR CONCEDED}`
  - `EloConsentMethod {CREATOR PARTICIPANT STAFF}`
  - `EloMatchStatus {DRAFT IN_PROGRESS AWAITING_CONFIRMATION DISPUTED COMPLETED CANCELLED VOIDED}`
- **How the spec's statuses map:**
  - READY = a DRAFT where both consents match the roster (derived);
  - PAUSED = IN_PROGRESS with `pausedAt` (same as competitive);
  - RESULT_PENDING = AWAITING_CONFIRMATION (the existing name).

| Model                    | Key fields                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EloSession`             | tournamentId, name, status, minTeamSize, maxTeamSize, minGamesForChampion, softReminderMinutes?, resultPolicy, nextSequence, configVersion, `championUserIds String[]`, openedAt, closedAt?                                                                                                                                                                                                                                              |
| `EloRatingRun`           | sessionId, revision (unique together); reason (INITIAL, CONFIG_CHANGE, CORRECTION, ROSTER_CORRECTION, RATED_CHANGED, VOID, MANUAL), triggeredById, note, **rating params** (initialRating, kFactor, ratingScale, `repeatMultipliers Float[]`, algorithmVersion), runtime (`process.version`), digestAtCreation, supersededAt?                                                                                                            |
| `EloMatch`               | sessionId, tableId → GameTable, status, rated, resultPolicy (copied at creation), createdById; rosterHash, consentA/B{Hash, ById, At, Method}, expiresAt?; startedAt, pausedAt, pausedDurationMs, endedAt; winnerSide, endType, cupsRemainingA/B?, submittedById/Side/At, confirmedById/At, disputedById/At/Note; resultVersion, confirmedSequence?, pairKey?, ratingMultiplier?, expectedScoreA?; cancelledById, cancelReason?; version |
| `EloMatchParticipant`    | matchId, userId → User, side, position 1–4, ratingAtStart? (informational). Unique on (matchId, userId) and (matchId, side, position).                                                                                                                                                                                                                                                                                                   |
| `EloActivePlayer`        | `userId` primary key, matchId, sessionId. Mirrors `ActiveTeamMatch`: one live match per user.                                                                                                                                                                                                                                                                                                                                            |
| `EloPlayerRating`        | (sessionId, userId) unique; rating, gamesPlayed, wins, losses, lowestRating, peakRating, lastSequence. This is the projection.                                                                                                                                                                                                                                                                                                           |
| `EloRatingChange`        | runId, runRevision, sessionId, matchId, userId, side, sequence, ratingBefore, delta, ratingAfter, expectedScore, teamSize, opponentTeamSize, multiplier, algorithmVersion. Unique on (runId, matchId, userId).                                                                                                                                                                                                                           |
| `EloMatchResultRevision` | (matchId, revision) unique, immutable; kind (SUBMITTED, AMENDED, CONFIRMED, DISPUTED, STAFF_FINAL, RESOLVED, CORRECTED, VOIDED, RATED_CHANGED), status, winnerSide, rated, endType, cups, `sideA String[]`, `sideB String[]`, actorId, reason                                                                                                                                                                                            |
| `EloMatchEvent`          | Timeline mirroring `MatchEvent` (its FK points at `Match`, so a separate table): CREATED, ROSTER_CHANGED, CONSENTED, STARTED, PAUSED, RESUMED, LEFT, CANCELLED, EXPIRED, …                                                                                                                                                                                                                                                               |

- The rating parameters live **only** on runs. The active run is the one without `supersededAt`. A parameter
  change is therefore structurally a new, audited run.
- **Raw-SQL migration `*_elo_constraints`**
  - Partial unique indexes:
    - `elo_session_single_open` on (tournamentId) WHERE status <> 'CLOSED';
    - `elo_table_one_live_match` on (tableId) WHERE status IN ('DRAFT','IN_PROGRESS');
    - `elo_run_single_active` on (sessionId) WHERE "supersededAt" IS NULL.
  - CHECKs on the session and run parameters:
    - the bounds from A4, `cardinality` of the multipliers, and `0 <= ALL(..) AND 1 >= ALL(..)`;
    - finite floats via `x > -1e9 AND x < 1e9`, which also rejects NaN and ±Infinity in Postgres;
    - participant position 1–4.
  - CHECKs on the match:
    - cups 0–10;
    - **consent:** a status other than DRAFT/CANCELLED requires `consentAHash = consentBHash = rosterHash`;
    - started statuses ⇒ `startedAt`;
    - AWAITING_CONFIRMATION, DISPUTED and COMPLETED ⇒ winnerSide + `endedAt`;
    - COMPLETED ⇒ `confirmedAt` + `confirmedSequence`; DISPUTED ⇒ `disputedAt`;
    - `pausedAt` only while IN_PROGRESS; durations, versions and multiplier/expected score within range.
  - CHECKs on the result revision: 1–4 players per side, `NOT ("sideA" && "sideB")`, and a winner unless VOIDED.
  - CHECKs on the projection: wins + losses = gamesPlayed, finite rating.
- `schema-invariants.int.test.ts` asserts every new index and CHECK; `docs/database.md` documents them.

### A6. Elo match lifecycle, consent, results

- **Transitions:**
  - DRAFT → IN_PROGRESS: start, only when both consents equal `rosterHash`.
  - DRAFT → CANCELLED: by the creator or staff; when the last player of a side leaves; or on expiry.
  - IN_PROGRESS → AWAITING_CONFIRMATION (a participant submits), → COMPLETED (staff final), or → CANCELLED (staff
    abandons, with a reason).
  - AWAITING_CONFIRMATION → COMPLETED (the opposing side confirms, or staff finalizes), → DISPUTED (Einspruch),
    or → VOIDED (staff, with a reason).
  - DISPUTED → COMPLETED or VOIDED (staff, with a reason).
  - COMPLETED → COMPLETED (admin correction) or → VOIDED (admin).
- **Locks:**
  - DRAFT and IN_PROGRESS hold the table (partial index) and the players (`EloActivePlayer`).
  - The first submission folds the pause into the duration, sets `endedAt` and releases both.
  - AWAITING_CONFIRMATION and DISPUTED still block a mode switch and closing the session.
- **Draft expiry (no cron):**
  - `expiresAt = last activity + 10 min`.
  - `sweepExpiredDrafts(tx, ctx.now)` runs at the start of every Elo write, `setGameMode` and `setTableDisabled`
    (status CANCELLED, reason EXPIRED, locks freed, an EXPIRED event).
  - Reads treat expired drafts as free tables.
  - Running matches never expire; the soft reminder is display-only.
- **Consent:**
  - `rosterHash = sha256(stableJson({A: sorted ids, B: sorted ids, rated}))`, using `stableJson` from
    `src/server/services/idempotency.ts:35`.
  - The creator's own side is consented automatically (CREATOR) on creation and on each of the creator's edits.
    Any roster change invalidates the other side's consent.
  - An opposing participant consents by sending the `rosterHash` they saw plus `expectedVersion` (PARTICIPANT).
  - A non-participating REFEREE+ can record in-person consent (STAFF, audited).
  - Only the creator or staff edit the roster. Anyone can remove themselves.
  - The side is always derived from the actor's participant row, never from client input.
  - The creator must be a participant or staff. QR links grant nothing.
- **Results (show and confirm; the policy is the copy stored on the match):**
  - A participant submits winner, end type and optional cups (AWAITING_CONFIRMATION, `submittedSide`).
  - The submitting side may amend while the other side has not acted yet (`resultVersion++`, revision AMENDED).
  - An opposing participant sees "Team A hat gewonnen (eingetragen von X)" and either confirms with the
    `resultVersion` they saw (COMPLETED, Elo applied) or disputes with an optional note (DISPUTED, no Elo).
  - A user can never act for both sides, because a player has exactly one participant row.
  - A non-participating staff member can finalize from IN_PROGRESS, AWAITING_CONFIRMATION or DISPUTED.
  - `REFEREE_ONLY`: participants submit and dispute, but only staff finalize.
  - Cups never influence Elo, and a cup disagreement is not a dispute.
- **Mechanics:**
  - `runIdempotent` scopes: `elo.submit`, `elo.confirm`, `elo.dispute`, `elo.staffFinal`, `elo.resolve`,
    `elo.correct`.
  - Optimistic `version` on every match write. `rosterHash` and `resultVersion` mismatches give
    STALE_VERSION or ROSTER_CHANGED.
  - Events in `EloMatchEvent`, one immutable result revision per result-defining step, `writeAudit` for staff and
    admin actions.

### A7. Ratings: one deterministic code path

- **Sequence:** the first transition to COMPLETED takes `confirmedSequence = nextSequence++` under the lock.
  - A resolved dispute is numbered when it is resolved.
  - Corrections and voids never renumber; voided matches are skipped.
  - Timestamps are never used for ordering.
- **Confirm path:**
  1. Load all COMPLETED matches of the session with their current roster, winner and rated flag (a few hundred
     rows at most).
  2. Run `replaySession` in memory, using the active run's parameters.
  3. Persist only the new step: change rows appended to the active run, the participants' projections, and
     `ratingMultiplier`, `expectedScoreA` and `pairKey` on the match.
- **Full replay** (correction of winner, roster, cups or rated flag; void; config change;
  manual "Neu berechnen"), all inside one locked transaction, so it is atomic and serialized against
  confirmations:
  1. Write the immutable result revision.
  2. Run `replaySession`.
  3. Create a new `EloRatingRun` with all its rows.
  4. Supersede the old run (its rows are kept as audit history).
  5. Rebuild `EloPlayerRating`.
- **Typed confirmations:** `ELO NEU BERECHNEN` for a parameter change when rated matches exist, and for a manual
  replay.
- **Repeat multiplier:** the prior count is the number of earlier-sequence COMPLETED, rated matches with the same
  `pairKey`.
  - Friendlies, pending, disputed, cancelled and voided matches don't count. Matches with multiplier 0 do count as
    an occurrence.
  - Default schedule [1, 1, 0.5, 0]; the last value applies to the 4th and all later meetings.
  - Replay recomputes the counts after a roster correction.
  - The builder shows the current prospective multiplier from `pairCounts` in the snapshot, with a hint that
    pending results can still change it.
- **Stats:** games, wins and losses count only _effective-rated_ matches (rated and multiplier > 0). They drive
  the provisional flag (fewer than minGames) and champion eligibility. A multiplier-0 match shows as
  "nicht gewertet (Wiederholung)".
- **Ranking and champion:**
  - Ranking uses full precision. Exact ties share a rank; rows within a tie are sorted by name, then id, for
    display only.
  - Champion = all eligible players with the top rating (co-champions on an exact tie; nothing picked
    arbitrarily).
  - Display: integer ratings, one decimal when neighbours would look equal; deltas with one decimal.
- **Achievements** (never affect Elo):
  - _Most Active_: most COMPLETED matches, friendlies included.
  - _Biggest Upset_: the lowest expected score among the winners of effective-rated matches.
  - _Best Comeback_: the largest `r_j − min_{i<j} r_i`, counted only if that minimum was below the initial rating.
  - Ties go to the earlier sequence, then the userId.
- **Determinism:**
  - Replay always starts from the run parameters; floats are never read back as inputs.
  - Change rows are emitted in (sequence, side, userId) order.
  - Within one runtime, "replay twice" must give an identical `projectionDigest`.
  - Across runtimes (Railway Node 24 vs local Node 26), `10 ** x` may differ in the last bit. The admin
    "Prüfen" dry run therefore reports the maximum deviation against a 1e-9 tolerance, and runs record
    `process.version`.
  - Only Prisma `Float` (double precision). PG 17 defaults to `extra_float_digits=1`, so values round-trip
    exactly.

### A8. Authorization (server-side; the snapshot `can` flags come from the same pure matrix)

| Action                                                                                                                                  | Who                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Create a draft                                                                                                                          | Any signed-in user in ELO mode with session OPEN, who is a participant or staff      |
| Edit roster / table                                                                                                                     | The creator or non-participating staff, while DRAFT                                  |
| Consent for a side                                                                                                                      | An authenticated participant of that side (STAFF method: non-participating REFEREE+) |
| Leave a draft                                                                                                                           | The participant themselves                                                           |
| Cancel a draft                                                                                                                          | The creator or staff                                                                 |
| Start / pause / resume                                                                                                                  | Any participant, or non-participating REFEREE+                                       |
| Submit / amend result                                                                                                                   | A participant (amend: the submitting side only)                                      |
| Confirm / dispute                                                                                                                       | An opposing-side participant (confirm: DUAL_TEAM only)                               |
| Staff final, resolve, void pending or disputed, abandon running                                                                         | Non-participating REFEREE+ (a reason is required for void, abandon and resolve)      |
| Correct, void completed, recalculate, change parameters or config, open/pause/close/reopen session, mode switch, public display, export | ADMIN (with reason and typed confirmation; `ELO-RUNDE BEENDEN` for closing)          |

### A9. UI (German, mobile-first, existing tokens and components)

- **Nav in ELO mode:** `navItems(role, gameMode)` shows Start, Spielen, Rangliste, Profil, plus Schiri
  (`/elo/referee`) for referees, Admin for admins, and Regeln for players. At most 5 items.
- **Routes:**
  - `/` → `EloHome`:
    - the arena (both tables, stopwatch or state);
    - a large "Match erstellen" CTA;
    - my invitations and confirmations;
    - top 5 plus my rank, recent results, achievements.
  - `/elo/play?table=N`: a 4-step builder (table → teams → preview → create).
    - Teams are picked in a searchable bottom sheet showing initials avatar, name and rating.
    - Busy players are disabled with a reason; I am preselected in Team A; no e-mails are shown.
    - The preview shows team averages, a win-probability bar, ±Elo for both outcomes, a repeat banner
      (100%, 50% or unrated) and the friendly toggle.
    - It then shows the waiting state "Team B muss bestätigen", followed by a large "Spiel starten".
  - `/elo/table/[number]` (public QR landing):
    - a free table shows a create CTA (signing in first if needed, with a safe `next`);
    - an occupied table shows the match and its stopwatch.
  - `/elo/matches/[id]`:
    - the essentials fit on one phone screen: roster, big stopwatch, pause, "Match beenden";
    - result entry is two-step (winner → review);
    - the opposing side gets Bestätigen/Einspruch;
    - the celebration shows the winner, each participant's ±Δ and new rating, and the new rank.
  - `/elo/rankings`: rank, avatar, name, Elo, games, W/L, win rate, Δ since start, provisional badge.
  - `/elo/players/[id]` and `/elo/players/me`: SVG rating chart, recent matches, teammates, opponents.
  - `/elo/referee`: staff board with tables, drafts (override/cancel), running matches, pending results and
    disputes.
- **Existing pages in ELO mode:**
  - `/referee` redirects to `/elo/referee`.
  - `/tournament` and `/admin/matches` show a banner and stay read-only history.
  - `/admin/tournament` table section shows a banner pointing to `/admin/elo` for occupancy.
- **`/rules`:** a separate Elo house-rules section:
  - each team gets exactly 2 throws per normal turn regardless of size; a solo player throws both, teams rotate;
  - no time limit; no draws; confirmation by both teams;
  - the formula in plain language; provisional status, repeats, friendlies.
  - The competitive rules text is unchanged.
- **`/display`:** `EloDisplayScreen`: two tables with stopwatches, top leaderboard, latest result,
  achievements, and a champion takeover when the session is closed.
- **Proxy:** add `/elo/play`, `/elo/referee`, `/elo/players/me` to PROTECTED and to the matcher. The other Elo
  pages render public data like `loadLiveInitial` (live or static).
- **Components** in `src/components/elo/`:
  - `player-avatar` (initials, colour from a userId hash over `--chart-1..5`);
  - `player-picker`, `match-builder`, `matchup-preview`, `elo-table-card`, `stopwatch`;
  - `result-entry`, `result-confirm`, `result-celebration` (respects reduced motion, never gesture-only);
  - `leaderboard`, `rating-chart` (hand-drawn SVG like `bracket.tsx`), `achievements`, `staff-board`,
    `elo-display`, `mode-watch`.
- **Reused:** `useLive`, `useMatchAction` (`src/components/referee/use-match-action.ts`),
  `getOrCreateIdempotencyKey` + `sessionKeyStore` (`src/lib/result-form.ts`), `Section`/`EmptyState`, `KpiTile`,
  `ConnectionBadge`, `ui/sheet`, `ui/avatar` (`AvatarGroup`), `AdminDialog`, `ReasonField`, `TypedConfirmField`,
  `useAdminAction`.
- **Copy:** German strings in `src/lib/i18n/de-elo.ts`.
- **Admin:**
  - The "Spielmodus" card on `/admin` (overview `Controls` grid): current mode, switch dialog, blocker list with
    links, "Entwürfe abbrechen".
  - `/admin/elo` (new `AdminSubnav` item):
    - session status and controls, KPIs, the dispute and pending queue;
    - matches with a correction dialog (winner, roster, cups, rated) and void;
    - ratings table and rating-run history;
    - settings (non-rating config) and rating parameters through the recalculation flow; "Prüfen" dry run;
    - public-display toggle (`setPublicDisplay`) and export.
  - `/admin/elo/qr`: printable QR SVGs rendered on the server from `APP_URL` + `/elo/table/N`, using the new
    dependency `qrcode` (+ `@types/qrcode`). QR codes are scanned with the phone's camera app; the
    `camera=()` Permissions-Policy stays.

## Implementation steps

After every step:

- `pnpm verify`;
- `git diff HEAD --shortstat` plus the CLAUDE.md §3b checkpoint message;
- commit (the spec asks for commits per phase; no push).

**Step 1: plan and spec into the repo.**

- `docs/elo-mode/implementation-plan.md` (this plan plus the architecture mapping).
- `claudecode-instructions/elo-spec.md` (the pasted spec, verbatim, next to the existing `spec.md`).
- Move `seededRng` into `src/server/domain/rng.ts`.

**Step 2: math engine, tests, simulation, report.** The first major deliverable.

- **Files:** `src/server/domain/elo/*` with `*.test.ts`.
- **Unit tests:**
  - Spec examples exactly: A (2v2: E = 0.5, ±12 per team, ±6 each); B (1v4: +12/−3, and −12/+3 if B wins);
    C (80 vs 120: E_A ≈ 0.2847, transfer ≈ 17.17, ±8.58).
  - D: all 16 team-size combinations.
  - fast-check properties: zero-sum ≤ 1e-9, equal shares within a side, correct signs, exact permutation
    invariance, A/B mirror symmetry within tolerance, an upset gains more than an expected win, probabilities in
    [0, 1].
  - Edge cases: ±1e6 differences give no NaN; invalid and duplicate input; the multiplier schedule; friendlies;
    cup independence.
  - Replay:
    - `replay(prefix + m)` equals applying m to the prefix;
    - replaying twice gives an identical digest;
    - an early correction changes the downstream rows;
    - void, friendly and pending counting rules.
  - Ranking and champion ties; achievements and their ties; roster, permission and transition matrices.
  - A vitest coverage threshold of ≥95% for `src/server/domain/elo/**`.
- **Simulation:** `src/server/sim/elo-montecarlo.ts` (pure, seeded) and `scripts/elo-validation.ts`
  (`pnpm elo:validate`).
  - Hidden true skill per player.
  - Participation patterns: casual (1–2), moderate (3–5), very active (6–10), mixed (with non-participants).
  - An event-like run: 24 players, 2 tables, at least 40 matches, team sizes 1–4, changing teams, repeats,
    disputes and cancels excluded, and an early correction that is replayed.
  - Several hundred seeds per pattern, plus a variant where team size gives a real advantage.
  - Metrics:
    - rating distribution and min/max;
    - Spearman correlation of rating vs skill; stability over the last 25%;
    - volatility by team size, and "solo gambling" (the champion odds of solo players vs team players of equal
      skill);
    - activity bias (top-3 share by participation), repeat rate;
    - the maximum of |Σ ratings − N·100|;
    - provisional count, and how often the top-rated player is provisional;
    - replay reproducibility.
  - Output: JSON to `data/elo-validation/` and a generated section in `docs/elo-mode/rating-validation.md` with
    the real numbers and an interpretation that flags serious incentive problems.
- **`docs/elo-mode/rating-system.md`:**
  - the formulas with the examples above;
  - standard Elo vs PharmaPong heuristics (D = 100 vs 400, K, team averaging, equal split, repeat multipliers,
    1v4 volatility);
  - assumptions and limitations; the `RatingEngine` extension point;
  - references (Elo expected score, Glicko-2, TrueSkill, Bayesian team ratings).
- **⏸ CHECKPOINT: present the results, then stop and wait for the user's review.** The user may tune K, D or
  the multipliers.

**Step 3: database.**

- Edit `prisma/schema.prisma`, then:
  ```
  git show HEAD:prisma/schema.prisma > $SCRATCH/schema.before.prisma
  pnpm prisma migrate diff --from-schema $SCRATCH/schema.before.prisma --to-schema prisma/schema.prisma --script -o prisma/migrations/<ts>_elo_mode/migration.sql
  grep -nE 'DROP|ALTER TYPE' prisma/migrations/<ts>_elo_mode/migration.sql   # must be empty
  # hand-write prisma/migrations/<ts+1>_elo_constraints/migration.sql
  pnpm prisma migrate deploy && pnpm prisma generate
  pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # no drift
  ```
- Do not enable the `partialIndexes` preview feature.
- Add the `pg-errors.ts` mappings, extend the `tx.ts` select, update `schema-invariants`, and add constraint
  cases to `constraints.int.test.ts`.
- Verify `migrate deploy` on an empty DB **and** on a dev DB in the `pnpm scenario completed` state (competitive
  data intact; the mode defaults to COMPETITIVE).

**Step 4: backend.**

- Services in `src/server/services/`:
  - `game-mode.ts` (get/set, blockers, `setPublicDisplay`);
  - `elo-session.ts` (open, pause, close with champions, reopen, config, parameter run);
  - `elo-matches.ts` (`withEloTx`, sweep, create, edit, consent, leave, cancel, start, pause, resume, abandon);
  - `elo-results.ts` (submit, amend, confirm, dispute, staff final, resolve, void pending);
  - `elo-ratings.ts` (history → domain replay → persist; dry-run verify);
  - `elo-corrections.ts`, `elo-read.ts`, `elo-snapshot.ts`, `elo-export.ts`.
- Actions: `src/server/actions/elo.ts`, `elo-admin.ts`.
- Routes: `api/elo/live`, `api/elo/live/public`, `api/mode`, `api/admin/elo-export` (CSV via the existing
  `toCsv`, `export.ts:118`).
- The A2 guards, `ensureTournamentForDeploy`, error codes and messages, and an Elo invariant helper next to
  `assertInvariants` (`tests/integration/match-fixtures.ts`).

**Step 5: core UI.**

- First load the available `ui-ux-pro-max:ui-ux-pro-max` skill for the new screens (spec §8.1).
  `docs/design-system.md` stays authoritative.
- Nav and `ModeWatch`, EloHome, builder and picker, match page, stopwatch, result entry and confirm,
  celebration, leaderboard.
- Check screenshots with `tests/tools/shot.ts` at 390×844 and on desktop (separate `NEXT_DIST_DIR` dev server).

**Step 6: social features.**

- QR landing and printable QR page; achievements; player profile with chart.
- Friendly and repeat banners, soft reminder; Elo rules section; `EloDisplayScreen` with champion takeover.

**Step 7: administration.**

- Mode card, `/admin/elo`, correction and dispute dialogs, run history, verify and recalculate, settings,
  public-display toggle, export, audit labels.

**Step 8: validation and docs.**

- DB-level event simulation: `src/server/sim/simulate-elo-event.ts`, `pnpm simulate:elo`. Its actual numbers
  are appended to `docs/elo-mode/rating-validation.md`.
- `pnpm scenario elo`: a fresh tournament in ELO mode with about 25 matches, 1 live match per table, 1 pending
  result, 1 dispute and 1 correction.
- E2E suite, a full regression run.
- Docs:
  - README (routes, scenario, mode);
  - a new `CHANGELOG.md` ([0.1.0] summarized from git history, [0.2.0] Elo Mode);
  - `docs/{architecture,database,deployment,tournament-rules,test-plan}.md` (the rules get a separate Elo
    section);
  - `docs/elo-mode/{user-guide,admin-guide}.md`.
- Bump `package.json` to `0.2.0`; update `.docs/project-status.md`. No Railway changes.

## Verification

- **Unit** (`pnpm test:unit`, `pnpm test:coverage`): everything in Step 2 at ≥95% coverage on the Elo domain;
  the existing 201 tests unchanged and green.
- **Integration** (`pnpm test:int`, `pharmapong_test`; new files `game-mode`, `elo-matches`, `elo-results`,
  `elo-concurrency`, `elo-replay`, `elo-live`, `elo-auth`, `elo-full-event`):
  - **Mode:** a player cannot switch; blockers in both modes; data survives a round trip; competitive
    assign/start in ELO gives WRONG_MODE, and so does Elo create in COMPETITIVE; `ensureTournamentForDeploy`
    keeps the Elo event; `setPublicDisplay` works on a COMPLETED tournament.
  - **Concurrency** (`Promise.allSettled`, as in `concurrency.int.test.ts`):
    - two live matches in parallel;
    - the same player in two drafts gives PLAYER_BUSY; two drafts on one table give TABLE_BUSY;
    - simultaneous submissions or confirmations, and 5 sends with the same idempotency key, produce exactly one set
      of change rows;
    - a stale version gives STALE_VERSION and a stale roster gives ROSTER_CHANGED;
    - a mode switch against an active match is blocked;
    - a replay racing a confirmation gives the same final state as running them in sequence.
  - **Auth:** nobody confirms for both sides; one side cannot act for the other; staff powers work, but not on
    their own match; players cannot change ratings, exceed the size limits, or consent for a side they are not on.
  - **Replay:** correct an early winner, check every downstream row and the runs, replay again for an identical
    digest, and check conservation.
  - **Full event:** 24 players, at least 40 matches over 2 parallel tables, disputes, cancels, a correction. Then:
    no leftover locks, the projection equals a fresh replay, zero-sum holds.
  - **Live:** no e-mails in any Elo snapshot; the picker list only when authenticated; the `can` flags per viewer;
    the 404 gate; the fast path.
  - **Regression:** every existing integration test passes unchanged; `full-event` also runs after a
    COMPETITIVE → ELO → COMPETITIVE round trip. A new `competitive-regression.int.test.ts` (reusing
    `match-fixtures.ts`) explicitly covers, after such a round trip:
    - group generation, result recording and knockout advancement;
    - the fixed 2-player team size;
    - the countdown, admin operations, and the public snapshot shape.
- **E2E** (`tests/e2e/elo.spec.ts`, desktop and mobile, plus axe and the no-overflow check at 390 px):
  - the admin switches the mode while player pages are open, and they follow;
  - `demo01` creates a match against `demo02`, who consents in a second browser context;
  - start, stopwatch ticking, pause and resume, submit;
  - `demo02` confirms, the celebration shows ±Elo, and the leaderboard updates;
  - `/display` shows the Elo view.
  - The existing E2E suite stays green.
- **Manual:** `pnpm scenario elo && pnpm dev`, then click through as admin, schiri and two players, using the
  Playwright MCP at 390×844, and `/display` at 1920×1080.
- **Deploy prep (local only):**
  - `pnpm build`.
  - `migrate deploy` on a fresh DB and on a copy holding competitive data.
  - A restart persistence check.
  - A rollback rehearsal: the previous build's `migrate deploy` must work against the new DB.
  - The runbook in `docs/deployment.md`:
    - deploy freeze during the event;
    - back up first (Railway backup / `pg_dump`); migrations apply through pre-deploy;
    - rollback = switch to COMPETITIVE with no live Elo matches, then redeploy the previous build;
    - a full DB rollback only via the documented down-SQL after a backup;
    - after a failed migration: `prisma migrate resolve --rolled-back`.

💡 _Recommended model for execution: **Opus** (user-confirmed). The work spans about 60 files: schema,
concurrency core, deterministic replay and UI. The CLAUDE.md Opus warning applies at execution start._
