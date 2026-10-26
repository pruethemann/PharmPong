import { describe, expect, it } from "vitest";
import { db } from "@/server/db";

const REQUIRED_INDEXES = [
  "tournament_one_open",
  "team_member_active_user",
  "team_member_active_slot",
  "match_one_active_per_table",
  "group_tiebreak_active",
  "User_email_key",
  "Team_inviteCode_key",
  "Team_tournamentId_nameNormalized_key",
  "GroupAssignment_teamId_key",
  "GroupAssignment_groupId_position_key",
  "Match_tournamentId_code_key",
  "Match_tournamentId_orderIndex_key",
  "Match_tournamentId_status_idx",
  // Elo Mode
  "elo_session_single_open",
  "elo_table_one_live_match",
  "elo_run_single_active",
  "EloActivePlayer_pkey",
  "EloMatch_sessionId_confirmedSequence_key",
  "EloMatchParticipant_matchId_userId_key",
  "EloMatchParticipant_matchId_side_position_key",
  "EloPlayerRating_sessionId_userId_key",
  "EloRatingRun_sessionId_revision_key",
  "EloRatingChange_runId_matchId_userId_key",
  "EloMatchResultRevision_matchId_revision_key",
];

const REQUIRED_CHECKS = [
  "tournament_revision_chk",
  "tournament_duration_chk",
  "team_member_slot_chk",
  "match_cups_chk",
  "match_distinct_teams_chk",
  "match_winner_chk",
  "match_done_has_result_chk",
  "match_active_has_table_chk",
  "match_active_has_teams_chk",
  "match_paused_chk",
  "match_version_chk",
  "group_assignment_position_chk",
  // Elo Mode
  "elo_session_settings_chk",
  "elo_run_params_chk",
  "elo_participant_position_chk",
  "elo_participant_rating_chk",
  "elo_match_cups_chk",
  "elo_match_consent_chk",
  "elo_match_started_chk",
  "elo_match_result_chk",
  "elo_match_completed_chk",
  "elo_match_pending_chk",
  "elo_match_disputed_chk",
  "elo_match_clock_chk",
  "elo_match_rating_chk",
  "elo_player_rating_chk",
  "elo_rating_change_chk",
  "elo_revision_roster_chk",
  "elo_revision_result_chk",
];

describe("schema invariants", () => {
  it("has all required indexes", async () => {
    const rows = await db.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = new Set(rows.map((r) => r.indexname));
    for (const ix of REQUIRED_INDEXES) expect(names, `missing index ${ix}`).toContain(ix);
  });

  it("has all required check constraints", async () => {
    const rows = await db.$queryRaw<
      { conname: string }[]
    >`SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    const names = new Set(rows.map((r) => r.conname));
    for (const c of REQUIRED_CHECKS) expect(names, `missing check ${c}`).toContain(c);
  });

  it("rejects a second open tournament", async () => {
    await db.tournament.create({ data: { name: "T1" } });
    await expect(db.tournament.create({ data: { name: "T2" } })).rejects.toThrow();
    await db.tournament.create({ data: { name: "Old", status: "COMPLETED" } });
  });
});
