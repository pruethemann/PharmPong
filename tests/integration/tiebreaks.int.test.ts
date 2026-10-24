import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import type { GroupName } from "@/server/domain/types";
import { generateDraw, startGroupStage, startKnockout } from "@/server/services/tournament";
import { listUnresolvedTies, recordRankingShootout, voidRankingShootout } from "@/server/services/tiebreaks";
import { makeTeam, makeTournament, makeUser } from "./factories";

type U = Awaited<ReturnType<typeof makeUser>>;
const actor = (u: U): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
  return "RESOLVED";
}

/** GROUP_STAGE with a fresh draw; returns team ids per group in draw position order. */
async function groupStage() {
  const admin = actor(await makeUser({ role: "ADMIN" }));
  const t = await makeTournament({ status: "REGISTRATION_LOCKED" });
  for (let i = 0; i < 12; i++) {
    const [a, b] = [await makeUser(), await makeUser()];
    await makeTeam(t.id, [a.id, b.id]);
  }
  const opts = { tournamentId: t.id };
  const draw = await generateDraw(admin, {}, opts);
  await startGroupStage(admin, opts);
  const groups = Object.fromEntries(draw.groups.map((g) => [g.name, g.teams.map((x) => x.id)])) as Record<
    GroupName,
    string[]
  >;
  return { admin, t, opts, groups };
}

async function decide(matchCode: string, tournamentId: string, winner: "HOME" | "AWAY", winnerCups = 3) {
  const m = await db.match.findFirstOrThrow({ where: { tournamentId, code: matchCode } });
  await db.match.update({
    where: { id: m.id },
    data: {
      status: "COMPLETED",
      winnerTeamId: winner === "HOME" ? m.homeTeamId : m.awayTeamId,
      homeCupsRemaining: winner === "HOME" ? winnerCups : 0,
      awayCupsRemaining: winner === "HOME" ? 0 : winnerCups,
      endType: "REGULAR",
      confirmedAt: new Date(),
      version: { increment: 1 },
    },
  });
}

/**
 * Group fixtures by draw position: round 1 = 1 vs 2, round 2 = 3 vs 1, round 3 = 2 vs 3.
 * "clear": position 1 > 2 > 3. "cycle": 1 beats 2, 3 beats 1, 2 beats 3 with
 * identical cups → a three-way tie that only a shootout resolves.
 */
async function playGroup(tournamentId: string, g: GroupName, mode: "clear" | "cycle") {
  if (mode === "clear") {
    await decide(`${g}-1`, tournamentId, "HOME");
    await decide(`${g}-2`, tournamentId, "AWAY");
    await decide(`${g}-3`, tournamentId, "HOME");
  } else {
    await decide(`${g}-1`, tournamentId, "HOME");
    await decide(`${g}-2`, tournamentId, "HOME");
    await decide(`${g}-3`, tournamentId, "HOME");
  }
}

describe("startKnockout gating", () => {
  it("is refused while a group match is undecided", async () => {
    const { admin, t, opts } = await groupStage();
    for (const g of ["A", "B", "C"] as const) await playGroup(t.id, g, "clear");
    await decide("D-1", t.id, "HOME");
    await decide("D-2", t.id, "AWAY");
    const err = await startKnockout(admin, opts).catch((e) => e);
    expect(err.code).toBe("GROUPS_INCOMPLETE");
    expect(err.details.pending).toEqual(["D-3"]);
    // An unconfirmed proposal does not count either.
    const d3 = await db.match.findFirstOrThrow({ where: { tournamentId: t.id, code: "D-3" } });
    const table = await db.gameTable.findFirstOrThrow({ where: { tournamentId: t.id } });
    await db.match.update({
      where: { id: d3.id },
      data: {
        status: "AWAITING_CONFIRMATION",
        tableId: table.id,
        winnerTeamId: d3.homeTeamId,
        homeCupsRemaining: 3,
        awayCupsRemaining: 0,
        endType: "REGULAR",
      },
    });
    expect(await code(startKnockout(admin, opts))).toBe("GROUPS_INCOMPLETE");
    const qf = await db.match.findMany({ where: { tournamentId: t.id, stage: "KNOCKOUT" } });
    expect(qf.every((m) => m.homeTeamId === null && m.status === "PENDING")).toBe(true);
  });

  it("is refused with an unresolved three-way tie, then works after the shootout with exact QF pairings", async () => {
    const { admin, t, opts, groups } = await groupStage();
    await playGroup(t.id, "A", "cycle");
    for (const g of ["B", "C", "D"] as const) await playGroup(t.id, g, "clear");

    const err = await startKnockout(admin, opts).catch((e) => e);
    expect(err.code).toBe("UNRESOLVED_TIE");
    expect(err.details.ties).toHaveLength(1);

    const ties = await listUnresolvedTies(t.id);
    expect(ties).toHaveLength(1);
    const tie = ties[0];
    expect(tie.group).toBe("A");
    expect(tie.teamIds).toEqual([...groups.A].sort());
    expect(tie.positions).toEqual([1, 2, 3]);
    expect(tie.teams.map((x) => x.id)).toEqual(tie.teamIds);

    // Shootout order: position 3 first, then 1, then 2.
    const order = [groups.A[2], groups.A[0], groups.A[1]];
    const rec = await recordRankingShootout(
      admin,
      { group: "A", basisHash: tie.basisHash, orderedTeamIds: order, note: "3 Runden" },
      opts,
    );
    const stored = await db.groupTiebreak.findUniqueOrThrow({ where: { id: rec.id } });
    expect(stored.teamIds).toEqual([...groups.A].sort());
    expect(stored.orderedTeamIds).toEqual(order);
    expect(stored.recordedById).toBe(admin.id);
    expect(await db.auditLog.count({ where: { action: "tiebreak.record", entityId: rec.id } })).toBe(1);
    expect(await listUnresolvedTies(t.id)).toEqual([]);

    const r = await startKnockout(admin, opts);
    expect(r.status).toBe("KNOCKOUT_STAGE");
    const A1 = order[0];
    const A2 = order[1];
    const [B1, B2] = groups.B;
    const [C1, C2] = groups.C;
    const [D1, D2] = groups.D;
    const qf = await db.match.findMany({
      where: { tournamentId: t.id, code: { in: ["QF1", "QF2", "QF3", "QF4"] } },
      orderBy: { orderIndex: "asc" },
    });
    expect(qf.map((m) => [m.code, m.homeTeamId, m.awayTeamId, m.status])).toEqual([
      ["QF1", A1, B2, "READY"],
      ["QF2", B1, A2, "READY"],
      ["QF3", C1, D2, "READY"],
      ["QF4", D1, C2, "READY"],
    ]);
    expect(qf.every((m) => m.version === 1)).toBe(true);
    const later = await db.match.findMany({
      where: { tournamentId: t.id, code: { in: ["SF1", "SF2", "F"] } },
    });
    expect(later.every((m) => m.status === "PENDING" && m.homeTeamId === null)).toBe(true);

    const adv = await db.matchEvent.findMany({ where: { tournamentId: t.id, type: "ADVANCED" } });
    expect(adv).toHaveLength(8);
    expect(adv.map((e) => e.payload)).toContainEqual({ teamId: A1, toCode: "QF1", slot: "HOME" });
    expect(adv.map((e) => e.payload)).toContainEqual({ teamId: C2, toCode: "QF4", slot: "AWAY" });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("KNOCKOUT_STAGE");

    // Shootouts are closed once the knockout stage runs.
    expect(await code(voidRankingShootout(admin, rec.id, "zu spät", opts))).toBe("INVALID_STATE");
    expect(await code(startKnockout(admin, opts))).toBe("INVALID_TRANSITION");
  });
});

describe("ranking shootouts", () => {
  async function tiedGroup() {
    const ctx = await groupStage();
    await playGroup(ctx.t.id, "A", "cycle");
    const [tie] = await listUnresolvedTies(ctx.t.id);
    return { ...ctx, tie };
  }

  it("rejects a stale basisHash with STALE_VERSION", async () => {
    const { admin, opts, groups, tie } = await tiedGroup();
    expect(
      await code(
        recordRankingShootout(admin, { group: "A", basisHash: "deadbeef", orderedTeamIds: groups.A }, opts),
      ),
    ).toBe("STALE_VERSION");
    // Wrong group for the same hash.
    expect(
      await code(
        recordRankingShootout(
          admin,
          { group: "B", basisHash: tie.basisHash, orderedTeamIds: groups.A },
          opts,
        ),
      ),
    ).toBe("STALE_VERSION");
  });

  it("becomes stale after a correction changes the tied stats", async () => {
    const { admin, t, opts, groups, tie } = await tiedGroup();
    // Correct A-1 to a closer score: the tie set changes and the old hash is stale.
    await decide("A-1", t.id, "HOME", 1);
    expect(
      await code(
        recordRankingShootout(
          admin,
          { group: "A", basisHash: tie.basisHash, orderedTeamIds: groups.A },
          opts,
        ),
      ),
    ).toBe("STALE_VERSION");
  });

  it("requires a permutation of the tied teams", async () => {
    const { admin, opts, groups, tie } = await tiedGroup();
    const base = { group: "A" as const, basisHash: tie.basisHash };
    for (const orderedTeamIds of [
      groups.A.slice(0, 2),
      [groups.A[0], groups.A[0], groups.A[1]],
      [groups.A[0], groups.A[1], groups.B[0]],
    ]) {
      expect(await code(recordRankingShootout(admin, { ...base, orderedTeamIds }, opts))).toBe("VALIDATION");
    }
    expect(await db.groupTiebreak.count()).toBe(0);
  });

  it("refuses to record twice for the same tie", async () => {
    const { admin, opts, groups, tie } = await tiedGroup();
    await recordRankingShootout(
      admin,
      { group: "A", basisHash: tie.basisHash, orderedTeamIds: groups.A },
      opts,
    );
    expect(
      await code(
        recordRankingShootout(
          admin,
          { group: "A", basisHash: tie.basisHash, orderedTeamIds: groups.A },
          opts,
        ),
      ),
    ).toBe("STALE_VERSION");
  });

  it("voiding brings the tie back and allows a new decision", async () => {
    const { admin, opts, groups, tie, t } = await tiedGroup();
    const rec = await recordRankingShootout(
      admin,
      { group: "A", basisHash: tie.basisHash, orderedTeamIds: groups.A },
      opts,
    );
    expect(await code(voidRankingShootout(admin, rec.id, "", opts))).toBe("VALIDATION");
    await voidRankingShootout(admin, rec.id, "Falsch erfasst", opts);
    expect((await db.groupTiebreak.findUniqueOrThrow({ where: { id: rec.id } })).voidedAt).toBeInstanceOf(
      Date,
    );
    expect(await code(voidRankingShootout(admin, rec.id, "nochmals", opts))).toBe("INVALID_STATE");
    expect(await listUnresolvedTies(t.id)).toHaveLength(1);
    const reversed = [...groups.A].reverse();
    await recordRankingShootout(
      admin,
      { group: "A", basisHash: tie.basisHash, orderedTeamIds: reversed },
      opts,
    );
    expect(await listUnresolvedTies(t.id)).toEqual([]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "tiebreak.void" } });
    expect(audit.reason).toBe("Falsch erfasst");
    expect(await code(voidRankingShootout(admin, "missing", "Grund", opts))).toBe("NOT_FOUND");
  });

  it("is only possible in GROUP_STAGE", async () => {
    const { admin, opts, groups, tie, t } = await tiedGroup();
    for (const status of ["REGISTRATION_LOCKED", "KNOCKOUT_STAGE", "COMPLETED"] as const) {
      await db.tournament.update({ where: { id: t.id }, data: { status } });
      expect(
        await code(
          recordRankingShootout(
            admin,
            { group: "A", basisHash: tie.basisHash, orderedTeamIds: groups.A },
            opts,
          ),
        ),
      ).toBe("INVALID_STATE");
    }
  });
});
