-- PharmaPong Elo Mode integrity constraints that Prisma's schema language cannot express.
-- Asserted by tests/integration/schema-invariants.int.test.ts. Never drop these in a generated
-- migration: review every generated diff (see docs/database.md).
-- Names must not contain an existing constraint name as a substring, because
-- src/server/services/pg-errors.ts maps violations with String.includes.
-- A CHECK passes when it evaluates to NULL, so nullable columns are guarded explicitly
-- (Prisma creates scalar-list columns as nullable arrays).

-- At most one non-closed Elo session per tournament (event).
CREATE UNIQUE INDEX "elo_session_single_open" ON "EloSession" ("tournamentId")
  WHERE status <> 'CLOSED';

-- A table hosts at most one live (draft or running) Elo match.
CREATE UNIQUE INDEX "elo_table_one_live_match" ON "EloMatch" ("tableId")
  WHERE status IN ('DRAFT', 'IN_PROGRESS');

-- Exactly one active (not superseded) rating run per session.
CREATE UNIQUE INDEX "elo_run_single_active" ON "EloRatingRun" ("sessionId")
  WHERE "supersededAt" IS NULL;

-- Session settings (rating parameters live on the runs).
ALTER TABLE "EloSession" ADD CONSTRAINT "elo_session_settings_chk" CHECK (
  "minTeamSize" BETWEEN 1 AND 4 AND
  "maxTeamSize" BETWEEN "minTeamSize" AND 4 AND
  "minGamesForChampion" BETWEEN 0 AND 100 AND
  ("softReminderMinutes" IS NULL OR "softReminderMinutes" BETWEEN 1 AND 240) AND
  "nextSequence" >= 1 AND
  "configVersion" >= 0);

-- Rating parameters. Comparisons also reject NaN and ±Infinity (NaN sorts above every number in Postgres).
ALTER TABLE "EloRatingRun" ADD CONSTRAINT "elo_run_params_chk" CHECK (
  revision >= 1 AND
  "initialRating" BETWEEN 0 AND 10000 AND
  "kFactor" > 0 AND "kFactor" <= 100 AND
  "ratingScale" BETWEEN 10 AND 1000 AND
  "repeatMultipliers" IS NOT NULL AND
  cardinality("repeatMultipliers") BETWEEN 1 AND 10 AND
  array_position("repeatMultipliers", NULL) IS NULL AND
  0 <= ALL ("repeatMultipliers") AND 1 >= ALL ("repeatMultipliers"));

-- Roster positions 1..4 per side (with the unique (matchId, side, position): at most 4 per side).
ALTER TABLE "EloMatchParticipant" ADD CONSTRAINT "elo_participant_position_chk" CHECK (position BETWEEN 1 AND 4);
ALTER TABLE "EloMatchParticipant" ADD CONSTRAINT "elo_participant_rating_chk" CHECK (
  "ratingAtStart" IS NULL OR ("ratingAtStart" > -1e9 AND "ratingAtStart" < 1e9));

ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_cups_chk" CHECK (
  ("cupsRemainingA" IS NULL OR "cupsRemainingA" BETWEEN 0 AND 10) AND
  ("cupsRemainingB" IS NULL OR "cupsRemainingB" BETWEEN 0 AND 10));
-- Leaving the draft (except to CANCELLED) requires both sides' consent to the current roster.
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_consent_chk" CHECK (
  status IN ('DRAFT', 'CANCELLED') OR
  ("consentAHash" IS NOT NULL AND "consentBHash" IS NOT NULL AND
   "consentAHash" = "rosterHash" AND "consentBHash" = "rosterHash"));
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_started_chk" CHECK (
  status IN ('DRAFT', 'CANCELLED') OR "startedAt" IS NOT NULL);
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_result_chk" CHECK (
  status NOT IN ('AWAITING_CONFIRMATION', 'DISPUTED', 'COMPLETED') OR
  ("winnerSide" IS NOT NULL AND "endType" IS NOT NULL AND "endedAt" IS NOT NULL));
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_completed_chk" CHECK (
  status <> 'COMPLETED' OR ("confirmedAt" IS NOT NULL AND "confirmedSequence" IS NOT NULL));
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_pending_chk" CHECK (
  status <> 'AWAITING_CONFIRMATION' OR ("submittedAt" IS NOT NULL AND "submittedSide" IS NOT NULL));
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_disputed_chk" CHECK (
  status <> 'DISPUTED' OR "disputedAt" IS NOT NULL);
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_clock_chk" CHECK (
  "pausedDurationMs" >= 0 AND ("pausedAt" IS NULL OR status = 'IN_PROGRESS'));
ALTER TABLE "EloMatch" ADD CONSTRAINT "elo_match_rating_chk" CHECK (
  ("ratingMultiplier" IS NULL OR "ratingMultiplier" BETWEEN 0 AND 1) AND
  ("expectedScoreA" IS NULL OR "expectedScoreA" BETWEEN 0 AND 1) AND
  ("confirmedSequence" IS NULL OR "confirmedSequence" >= 1) AND
  version >= 0 AND "resultVersion" >= 0);

ALTER TABLE "EloPlayerRating" ADD CONSTRAINT "elo_player_rating_chk" CHECK (
  rating > -1e9 AND rating < 1e9 AND
  "lowestRating" > -1e9 AND "lowestRating" < 1e9 AND
  "peakRating" > -1e9 AND "peakRating" < 1e9 AND
  "gamesPlayed" >= 0 AND wins >= 0 AND losses >= 0 AND wins + losses = "gamesPlayed");

ALTER TABLE "EloRatingChange" ADD CONSTRAINT "elo_rating_change_chk" CHECK (
  "ratingBefore" > -1e9 AND "ratingBefore" < 1e9 AND
  "ratingAfter" > -1e9 AND "ratingAfter" < 1e9 AND
  delta > -1e9 AND delta < 1e9 AND
  "expectedScore" BETWEEN 0 AND 1 AND
  multiplier BETWEEN 0 AND 1 AND
  "teamSize" BETWEEN 1 AND 4 AND "opponentTeamSize" BETWEEN 1 AND 4 AND
  sequence >= 1 AND "runRevision" >= 1);

-- Result revisions: 1–4 players per side, nobody on both sides, a winner unless voided.
ALTER TABLE "EloMatchResultRevision" ADD CONSTRAINT "elo_revision_roster_chk" CHECK (
  "sideA" IS NOT NULL AND "sideB" IS NOT NULL AND
  cardinality("sideA") BETWEEN 1 AND 4 AND
  cardinality("sideB") BETWEEN 1 AND 4 AND
  array_position("sideA", NULL) IS NULL AND array_position("sideB", NULL) IS NULL AND
  NOT ("sideA" && "sideB"));
ALTER TABLE "EloMatchResultRevision" ADD CONSTRAINT "elo_revision_result_chk" CHECK (
  revision >= 1 AND
  (kind = 'VOIDED' OR "winnerSide" IS NOT NULL) AND
  ("cupsRemainingA" IS NULL OR "cupsRemainingA" BETWEEN 0 AND 10) AND
  ("cupsRemainingB" IS NULL OR "cupsRemainingB" BETWEEN 0 AND 10));
