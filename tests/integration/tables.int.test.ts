import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { renameTable, setTableDisabled } from "@/server/services/tables";
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

async function setup() {
  const admin = actor(await makeUser({ role: "ADMIN" }));
  const t = await makeTournament({ status: "GROUP_STAGE" });
  const [t1, t2] = await db.gameTable.findMany({ where: { tournamentId: t.id }, orderBy: { number: "asc" } });
  return { admin, t, t1, t2 };
}

async function activeMatchOn(
  tournamentId: string,
  tableId: string,
  status: "ASSIGNED" | "IN_PROGRESS" | "AWAITING_CONFIRMATION",
) {
  const home = await makeTeam(tournamentId, [(await makeUser()).id, (await makeUser()).id]);
  const away = await makeTeam(tournamentId, [(await makeUser()).id, (await makeUser()).id]);
  const n = await db.match.count();
  return db.match.create({
    data: {
      tournamentId,
      code: `X-${n + 1}`,
      stage: "GROUP",
      round: 1,
      orderIndex: n + 1,
      homeTeamId: home.id,
      awayTeamId: away.id,
      status,
      tableId,
    },
  });
}

describe("tables", () => {
  it.each(["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"] as const)(
    "disabling a table with a %s match fails with TABLE_BUSY",
    async (status) => {
      const { admin, t, t1 } = await setup();
      const m = await activeMatchOn(t.id, t1.id, status);
      const err = await setTableDisabled(admin, t1.id, true, "Tischbein gebrochen").catch((e) => e);
      expect(err.code).toBe("TABLE_BUSY");
      expect(err.details).toMatchObject({ matchId: m.id });
      expect((await db.gameTable.findUniqueOrThrow({ where: { id: t1.id } })).isDisabled).toBe(false);
    },
  );

  it("disables a free table (completed history does not block) and re-enables it", async () => {
    const { admin, t, t1, t2 } = await setup();
    const m = await activeMatchOn(t.id, t1.id, "ASSIGNED");
    await db.match.update({
      where: { id: m.id },
      data: {
        status: "COMPLETED",
        winnerTeamId: m.homeTeamId,
        homeCupsRemaining: 1,
        awayCupsRemaining: 0,
        endType: "REGULAR",
        confirmedAt: new Date(),
      },
    });
    const rev0 = (await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).revision;
    const r = await setTableDisabled(admin, t1.id, true, "Bier verschüttet");
    expect(r).toEqual({ id: t1.id, isDisabled: true, changed: true });
    expect((await db.gameTable.findUniqueOrThrow({ where: { id: t1.id } })).isDisabled).toBe(true);
    expect((await db.gameTable.findUniqueOrThrow({ where: { id: t2.id } })).isDisabled).toBe(false);
    const rev1 = (await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).revision;
    expect(rev1).toBeGreaterThan(rev0);

    // No-op does not bump the revision.
    expect((await setTableDisabled(admin, t1.id, true, "nochmals")).changed).toBe(false);
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).revision).toBe(rev1);

    await setTableDisabled(admin, t1.id, false, "");
    expect((await db.gameTable.findUniqueOrThrow({ where: { id: t1.id } })).isDisabled).toBe(false);
    const audits = await db.auditLog.findMany({ where: { entityId: t1.id }, orderBy: { id: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["table.disable", "table.enable"]);
    expect(audits[0].reason).toBe("Bier verschüttet");
  });

  it("disabling requires a reason", async () => {
    const { admin, t1 } = await setup();
    expect(await code(setTableDisabled(admin, t1.id, true, " "))).toBe("VALIDATION");
  });

  it("renames a table with validation and audit", async () => {
    const { admin, t1 } = await setup();
    expect(await renameTable(admin, t1.id, "  Tisch   Zentrifuge ")).toEqual({
      id: t1.id,
      name: "Tisch Zentrifuge",
    });
    expect(await code(renameTable(admin, t1.id, "   "))).toBe("VALIDATION");
    expect(await code(renameTable(admin, t1.id, "x".repeat(41)))).toBe("VALIDATION");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "table.rename" } });
    expect(audit.before).toEqual({ name: "Tisch 1" });
    expect(audit.after).toEqual({ name: "Tisch Zentrifuge" });
  });

  it("unknown tables are NOT_FOUND; non-admins are FORBIDDEN", async () => {
    const { admin, t1 } = await setup();
    expect(await code(setTableDisabled(admin, "missing", true, "kaputt"))).toBe("NOT_FOUND");
    expect(await code(renameTable(admin, "missing", "Neu"))).toBe("NOT_FOUND");
    const ref = actor(await makeUser({ role: "REFEREE" }));
    expect(await code(setTableDisabled(ref, t1.id, true, "kaputt"))).toBe("FORBIDDEN");
    expect(await code(renameTable(ref, t1.id, "Neu"))).toBe("FORBIDDEN");
  });
});
