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
