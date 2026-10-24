-- PharmaPong integrity constraints that Prisma's schema language cannot express.
-- Asserted by tests/integration/schema-invariants.int.test.ts. Never drop these
-- in a generated migration: review every `prisma migrate dev` output.

-- At most one non-finished tournament at a time.
CREATE UNIQUE INDEX "tournament_one_open" ON "Tournament" ((true))
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');

ALTER TABLE "Tournament" ADD CONSTRAINT "tournament_revision_chk" CHECK (revision >= 0);
ALTER TABLE "Tournament" ADD CONSTRAINT "tournament_duration_chk" CHECK ("matchDurationSec" BETWEEN 60 AND 3600);

-- A user can be an active member of only one team per tournament.
CREATE UNIQUE INDEX "team_member_active_user" ON "TeamMember" ("tournamentId", "userId")
  WHERE "leftAt" IS NULL;
-- A team has at most two active members (slots 1 and 2).
CREATE UNIQUE INDEX "team_member_active_slot" ON "TeamMember" ("teamId", slot)
  WHERE "leftAt" IS NULL;
ALTER TABLE "TeamMember" ADD CONSTRAINT "team_member_slot_chk" CHECK (slot IN (1, 2));

-- A table can host only one active match.
CREATE UNIQUE INDEX "match_one_active_per_table" ON "Match" ("tableId")
  WHERE "tableId" IS NOT NULL AND status IN ('ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION');

ALTER TABLE "Match" ADD CONSTRAINT "match_cups_chk" CHECK (
  ("homeCupsRemaining" IS NULL OR "homeCupsRemaining" BETWEEN 0 AND 10) AND
  ("awayCupsRemaining" IS NULL OR "awayCupsRemaining" BETWEEN 0 AND 10));
ALTER TABLE "Match" ADD CONSTRAINT "match_distinct_teams_chk" CHECK (
  "homeTeamId" IS NULL OR "awayTeamId" IS NULL OR "homeTeamId" <> "awayTeamId");
ALTER TABLE "Match" ADD CONSTRAINT "match_winner_chk" CHECK (
  "winnerTeamId" IS NULL OR "winnerTeamId" = "homeTeamId" OR "winnerTeamId" = "awayTeamId");
ALTER TABLE "Match" ADD CONSTRAINT "match_done_has_result_chk" CHECK (
  status NOT IN ('COMPLETED', 'FORFEITED') OR
  ("winnerTeamId" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "endType" IS NOT NULL));
ALTER TABLE "Match" ADD CONSTRAINT "match_active_has_table_chk" CHECK (
  status NOT IN ('ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION') OR "tableId" IS NOT NULL);
ALTER TABLE "Match" ADD CONSTRAINT "match_active_has_teams_chk" CHECK (
  status IN ('PENDING', 'CANCELLED') OR ("homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL));
ALTER TABLE "Match" ADD CONSTRAINT "match_paused_chk" CHECK ("pausedDurationMs" >= 0);
ALTER TABLE "Match" ADD CONSTRAINT "match_version_chk" CHECK (version >= 0);

-- Group assignment positions 1..3.
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "group_assignment_position_chk" CHECK (position BETWEEN 1 AND 3);

-- Only one live (non-voided) tiebreak decision per tie basis.
CREATE UNIQUE INDEX "group_tiebreak_active" ON "GroupTiebreak" ("groupId", "basisHash")
  WHERE "voidedAt" IS NULL;
