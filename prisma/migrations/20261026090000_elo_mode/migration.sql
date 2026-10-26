-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('COMPETITIVE', 'ELO');

-- CreateEnum
CREATE TYPE "EloSessionStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EloSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "EloResultPolicy" AS ENUM ('DUAL_TEAM_CONFIRMATION', 'REFEREE_ONLY');

-- CreateEnum
CREATE TYPE "EloEndType" AS ENUM ('REGULAR', 'CONCEDED');

-- CreateEnum
CREATE TYPE "EloConsentMethod" AS ENUM ('CREATOR', 'PARTICIPANT', 'STAFF');

-- CreateEnum
CREATE TYPE "EloMatchStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'VOIDED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "gameMode" "GameMode" NOT NULL DEFAULT 'COMPETITIVE',
ADD COLUMN     "gameModeChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EloSession" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EloSessionStatus" NOT NULL DEFAULT 'OPEN',
    "minTeamSize" INTEGER NOT NULL DEFAULT 1,
    "maxTeamSize" INTEGER NOT NULL DEFAULT 4,
    "minGamesForChampion" INTEGER NOT NULL DEFAULT 3,
    "softReminderMinutes" INTEGER DEFAULT 20,
    "resultPolicy" "EloResultPolicy" NOT NULL DEFAULT 'DUAL_TEAM_CONFIRMATION',
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "configVersion" INTEGER NOT NULL DEFAULT 0,
    "championUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EloSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloRatingRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeredById" TEXT,
    "note" TEXT,
    "algorithmVersion" TEXT NOT NULL,
    "initialRating" DOUBLE PRECISION NOT NULL,
    "kFactor" DOUBLE PRECISION NOT NULL,
    "ratingScale" DOUBLE PRECISION NOT NULL,
    "repeatMultipliers" DOUBLE PRECISION[],
    "runtime" TEXT NOT NULL,
    "digestAtCreation" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloRatingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloMatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "EloMatchStatus" NOT NULL DEFAULT 'DRAFT',
    "rated" BOOLEAN NOT NULL DEFAULT true,
    "resultPolicy" "EloResultPolicy" NOT NULL,
    "createdById" TEXT NOT NULL,
    "rosterHash" TEXT NOT NULL,
    "consentAHash" TEXT,
    "consentAById" TEXT,
    "consentAAt" TIMESTAMP(3),
    "consentAMethod" "EloConsentMethod",
    "consentBHash" TEXT,
    "consentBById" TEXT,
    "consentBAt" TIMESTAMP(3),
    "consentBMethod" "EloConsentMethod",
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedDurationMs" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "winnerSide" "EloSide",
    "endType" "EloEndType",
    "cupsRemainingA" INTEGER,
    "cupsRemainingB" INTEGER,
    "submittedById" TEXT,
    "submittedSide" "EloSide",
    "submittedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "disputedById" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeNote" TEXT,
    "resultVersion" INTEGER NOT NULL DEFAULT 0,
    "confirmedSequence" INTEGER,
    "pairKey" TEXT,
    "ratingMultiplier" DOUBLE PRECISION,
    "expectedScoreA" DOUBLE PRECISION,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EloMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloMatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" "EloSide" NOT NULL,
    "position" INTEGER NOT NULL,
    "ratingAtStart" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloMatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloActivePlayer" (
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloActivePlayer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EloPlayerRating" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "lowestRating" DOUBLE PRECISION NOT NULL,
    "peakRating" DOUBLE PRECISION NOT NULL,
    "lastSequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EloPlayerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloRatingChange" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runRevision" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" "EloSide" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "ratingBefore" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "ratingAfter" DOUBLE PRECISION NOT NULL,
    "expectedScore" DOUBLE PRECISION NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "opponentTeamSize" INTEGER NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloRatingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloMatchResultRevision" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "EloMatchStatus" NOT NULL,
    "winnerSide" "EloSide",
    "rated" BOOLEAN NOT NULL,
    "endType" "EloEndType",
    "cupsRemainingA" INTEGER,
    "cupsRemainingB" INTEGER,
    "sideA" TEXT[],
    "sideB" TEXT[],
    "actorId" TEXT,
    "reason" TEXT,
    "previous" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloMatchResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloMatchEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloMatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EloSession_tournamentId_createdAt_idx" ON "EloSession"("tournamentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EloRatingRun_sessionId_revision_key" ON "EloRatingRun"("sessionId", "revision");

-- CreateIndex
CREATE INDEX "EloMatch_sessionId_status_idx" ON "EloMatch"("sessionId", "status");

-- CreateIndex
CREATE INDEX "EloMatch_tableId_idx" ON "EloMatch"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "EloMatch_sessionId_confirmedSequence_key" ON "EloMatch"("sessionId", "confirmedSequence");

-- CreateIndex
CREATE INDEX "EloMatchParticipant_userId_idx" ON "EloMatchParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EloMatchParticipant_matchId_userId_key" ON "EloMatchParticipant"("matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EloMatchParticipant_matchId_side_position_key" ON "EloMatchParticipant"("matchId", "side", "position");

-- CreateIndex
CREATE INDEX "EloActivePlayer_matchId_idx" ON "EloActivePlayer"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "EloPlayerRating_sessionId_userId_key" ON "EloPlayerRating"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "EloRatingChange_runId_userId_idx" ON "EloRatingChange"("runId", "userId");

-- CreateIndex
CREATE INDEX "EloRatingChange_matchId_idx" ON "EloRatingChange"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "EloRatingChange_runId_matchId_userId_key" ON "EloRatingChange"("runId", "matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EloMatchResultRevision_matchId_revision_key" ON "EloMatchResultRevision"("matchId", "revision");

-- CreateIndex
CREATE INDEX "EloMatchEvent_matchId_createdAt_idx" ON "EloMatchEvent"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "EloMatchEvent_sessionId_createdAt_idx" ON "EloMatchEvent"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "EloSession" ADD CONSTRAINT "EloSession_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloRatingRun" ADD CONSTRAINT "EloRatingRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EloSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatch" ADD CONSTRAINT "EloMatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EloSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatch" ADD CONSTRAINT "EloMatch_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "GameTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatchParticipant" ADD CONSTRAINT "EloMatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "EloMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatchParticipant" ADD CONSTRAINT "EloMatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloActivePlayer" ADD CONSTRAINT "EloActivePlayer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EloSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloPlayerRating" ADD CONSTRAINT "EloPlayerRating_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EloSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloPlayerRating" ADD CONSTRAINT "EloPlayerRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloRatingChange" ADD CONSTRAINT "EloRatingChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EloRatingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloRatingChange" ADD CONSTRAINT "EloRatingChange_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "EloMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatchResultRevision" ADD CONSTRAINT "EloMatchResultRevision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "EloMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloMatchEvent" ADD CONSTRAINT "EloMatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "EloMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
