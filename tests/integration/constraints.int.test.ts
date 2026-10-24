import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { withTournamentTx } from "@/server/services/tx";
import { makeTeam, makeTournament, makeUser } from "./factories";

describe("database constraints", () => {
  it("prevents a user from being active in two teams", async () => {
    const t = await makeTournament();
    const u = await makeUser();
    await makeTeam(t.id, [u.id]);
    const other = await makeTeam(t.id);
    await expect(
      db.teamMember.create({ data: { tournamentId: t.id, teamId: other.id, userId: u.id, slot: 1 } }),
    ).rejects.toThrow();
  });

  it("allows rejoining after leaving", async () => {
    const t = await makeTournament();
    const u = await makeUser();
    const a = await makeTeam(t.id, [u.id]);
    await db.teamMember.updateMany({ where: { teamId: a.id, userId: u.id }, data: { leftAt: new Date() } });
    const b = await makeTeam(t.id);
    await db.teamMember.create({ data: { tournamentId: t.id, teamId: b.id, userId: u.id, slot: 1 } });
  });

  it("limits teams to two active slots", async () => {
    const t = await makeTournament();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const team = await makeTeam(t.id, [a.id, b.id]);
    await expect(
      db.teamMember.create({ data: { tournamentId: t.id, teamId: team.id, userId: c.id, slot: 3 } }),
    ).rejects.toThrow();
    await expect(
      db.teamMember.create({ data: { tournamentId: t.id, teamId: team.id, userId: c.id, slot: 2 } }),
    ).rejects.toThrow();
  });

  it("rejects out-of-range cup counts", async () => {
    const t = await makeTournament();
    await expect(
      db.match.create({
        data: {
          tournamentId: t.id,
          code: "X",
          stage: "GROUP",
          round: 1,
          orderIndex: 1,
          homeCupsRemaining: 11,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects two active matches on one table", async () => {
    const t = await makeTournament();
    const table = await db.gameTable.findFirstOrThrow({ where: { tournamentId: t.id, number: 1 } });
    const teams = await Promise.all([0, 1, 2, 3].map(() => makeTeam(t.id)));
    await db.match.create({
      data: {
        tournamentId: t.id,
        code: "M1",
        stage: "GROUP",
        round: 1,
        orderIndex: 1,
        status: "ASSIGNED",
        tableId: table.id,
        homeTeamId: teams[0].id,
        awayTeamId: teams[1].id,
      },
    });
    await expect(
      db.match.create({
        data: {
          tournamentId: t.id,
          code: "M2",
          stage: "GROUP",
          round: 1,
          orderIndex: 2,
          status: "IN_PROGRESS",
          tableId: table.id,
          homeTeamId: teams[2].id,
          awayTeamId: teams[3].id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a completed match without a confirmed result", async () => {
    const t = await makeTournament();
    const teams = await Promise.all([0, 1].map(() => makeTeam(t.id)));
    await expect(
      db.match.create({
        data: {
          tournamentId: t.id,
          code: "M1",
          stage: "GROUP",
          round: 1,
          orderIndex: 1,
          status: "COMPLETED",
          homeTeamId: teams[0].id,
          awayTeamId: teams[1].id,
          winnerTeamId: teams[0].id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a winner that is not one of the teams", async () => {
    const t = await makeTournament();
    const teams = await Promise.all([0, 1, 2].map(() => makeTeam(t.id)));
    await expect(
      db.match.create({
        data: {
          tournamentId: t.id,
          code: "M1",
          stage: "GROUP",
          round: 1,
          orderIndex: 1,
          homeTeamId: teams[0].id,
          awayTeamId: teams[1].id,
          winnerTeamId: teams[2].id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("withTournamentTx", () => {
  it("bumps the revision on commit", async () => {
    const t = await makeTournament();
    await withTournamentTx(t.id, async () => undefined);
    await withTournamentTx(t.id, async () => undefined);
    const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.revision).toBe(2);
  });

  it("does not bump when not dirty", async () => {
    const t = await makeTournament();
    await withTournamentTx(t.id, async (_tx, ctx) => {
      ctx.dirty = false;
    });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).revision).toBe(0);
  });

  it("rolls back all writes and the revision when work fails", async () => {
    const t = await makeTournament();
    await expect(
      withTournamentTx(
        t.id,
        async (tx) => {
          await tx.tournament.update({ where: { id: t.id }, data: { name: "changed" } });
        },
        {
          afterWork: async () => {
            throw new Error("boom");
          },
        },
      ),
    ).rejects.toThrow();
    const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.name).toBe("PharmaPong Test");
    expect(after.revision).toBe(0);
  });

  it("serializes concurrent writers", async () => {
    const t = await makeTournament();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        withTournamentTx(t.id, async (tx) => {
          const cur = await tx.tournament.findUniqueOrThrow({ where: { id: t.id } });
          await tx.tournament.update({
            where: { id: t.id },
            data: { matchDurationSec: cur.matchDurationSec + 1 },
          });
        }),
      ),
    );
    const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.matchDurationSec).toBe(910);
    expect(after.revision).toBe(10);
  });
});
