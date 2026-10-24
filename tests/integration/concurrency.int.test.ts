import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { purgeIdempotencyKeys } from "@/server/services/idempotency";
import { assignMatch } from "@/server/services/matches";
import { confirmResult, proposeResult, type ResultMutation } from "@/server/services/results";
import {
  assertInvariants,
  assignAndStart,
  buildDrawnTournament,
  buildKnockoutTournament,
  errorCode,
  getMatch,
  getTournament,
  idemKey,
  type Fixture,
} from "./match-fixtures";

let current: Fixture | null = null;

afterEach(async () => {
  if (current) await assertInvariants(current.t.id);
  current = null;
});

const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? "OK" : ((r.reason as { code?: string }).code ?? String(r.reason));

/** Started QF1 with a proposal (home wins 3:0). */
async function proposedQf1(fx: Fixture): Promise<ResultMutation> {
  const m = await assignAndStart(fx, "QF1");
  return proposeResult(fx.referee, {
    matchId: m.id,
    expectedVersion: m.version,
    idempotencyKey: idemKey(),
    winnerTeamId: m.homeTeamId!,
    homeCupsRemaining: 3,
    awayCupsRemaining: 0,
    endType: "REGULAR",
  });
}

describe("concurrent referees", () => {
  it("5 referees confirm the same match → exactly 1 succeeds, the rest STALE_VERSION", async () => {
    const { fx, qualifiers } = await buildKnockoutTournament();
    current = fx;
    const p = await proposedQf1(fx);
    const revBefore = (await getTournament(fx)).revision;

    const settled = await Promise.allSettled(
      fx.referees.map((ref) =>
        confirmResult(ref, {
          matchId: p.matchId,
          expectedVersion: p.version,
          resultRevision: p.resultRevision,
          idempotencyKey: idemKey(),
        }),
      ),
    );
    const codes = settled.map(codeOf);
    expect(codes.filter((c) => c === "OK")).toHaveLength(1);
    expect(codes.filter((c) => c === "STALE_VERSION")).toHaveLength(4);

    const qf1 = await getMatch(fx, "QF1");
    expect(qf1).toMatchObject({
      status: "COMPLETED",
      resultRevision: p.resultRevision,
      version: p.version + 1,
    });
    const sf1 = await getMatch(fx, "SF1");
    expect(sf1.homeTeamId).toBe(qualifiers.A1);
    expect(sf1.version).toBe(1);
    expect(await db.matchEvent.count({ where: { matchId: sf1.id, type: "ADVANCED" } })).toBe(1);
    expect(await db.matchEvent.count({ where: { matchId: qf1.id, type: "CONFIRMED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: qf1.id, action: "match.confirm" } })).toBe(1);
    expect((await getTournament(fx)).revision).toBe(revBefore + 1);
    // Failed attempts left no idempotency rows behind.
    expect(await db.idempotencyKey.count({ where: { scope: "match.confirm" } })).toBe(1);
  });

  it("the same idempotency key sent 5× in parallel → one mutation, 5 identical responses", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    const p = await proposedQf1(fx);
    const revBefore = (await getTournament(fx)).revision;
    const key = idemKey();
    const input = {
      matchId: p.matchId,
      expectedVersion: p.version,
      resultRevision: p.resultRevision,
      idempotencyKey: key,
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => confirmResult(fx.referee, input)));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toMatchObject({ status: "COMPLETED", advanced: { toCode: "SF1", slot: "HOME" } });
    expect(await db.matchEvent.count({ where: { matchId: p.matchId, type: "CONFIRMED" } })).toBe(1);
    expect(await db.matchEvent.count({ where: { type: "ADVANCED" } })).toBe(1);
    expect((await getTournament(fx)).revision).toBe(revBefore + 1);
    expect(await db.idempotencyKey.count({ where: { key } })).toBe(1);

    // A later replay (the client retrying after a lost response) still returns the same body.
    expect(await confirmResult(fx.referee, input)).toEqual(results[0]);
  });

  it("duplicate proposals with one key in parallel → one proposal", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const m = await assignAndStart(fx, "A-1");
    const input = {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: idemKey(),
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR" as const,
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => proposeResult(fx.referee, input)));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0].resultRevision).toBe(1);
    expect(await db.matchEvent.count({ where: { matchId: m.id, type: "PROPOSED" } })).toBe(1);
  });

  it("same key with a different payload or another user → IDEMPOTENCY_MISMATCH", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const m = await assignAndStart(fx, "A-1");
    const key = idemKey();
    const base = {
      matchId: m.id,
      expectedVersion: m.version,
      idempotencyKey: key,
      winnerTeamId: m.homeTeamId!,
      homeCupsRemaining: 1,
      awayCupsRemaining: 0,
      endType: "REGULAR" as const,
    };
    await proposeResult(fx.referee, base);
    expect(await errorCode(proposeResult(fx.referee, { ...base, homeCupsRemaining: 2 }))).toBe(
      "IDEMPOTENCY_MISMATCH",
    );
    expect(await errorCode(proposeResult(fx.referees[1], base))).toBe("IDEMPOTENCY_MISMATCH");
    const p = await getMatch(fx, "A-1");
    expect(
      await errorCode(
        confirmResult(fx.referee, {
          matchId: m.id,
          expectedVersion: p.version,
          resultRevision: p.resultRevision,
          idempotencyKey: key, // a propose key reused for confirm
        }),
      ),
    ).toBe("IDEMPOTENCY_MISMATCH");
    expect((await getMatch(fx, "A-1")).homeCupsRemaining).toBe(1);
  });

  it("propose with a stale version → STALE_VERSION", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const m = await assignAndStart(fx, "A-1");
    expect(
      await errorCode(
        proposeResult(fx.referee, {
          matchId: m.id,
          expectedVersion: m.version - 1,
          idempotencyKey: idemKey(),
          winnerTeamId: m.homeTeamId!,
          homeCupsRemaining: 1,
          awayCupsRemaining: 0,
          endType: "REGULAR",
        }),
      ),
    ).toBe("STALE_VERSION");
    expect(await db.idempotencyKey.count()).toBe(0);
  });
});

describe("concurrent assignment", () => {
  it("two matches assigned to the same table in parallel → one TABLE_BUSY", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const [a1, c1] = await Promise.all([getMatch(fx, "A-1"), getMatch(fx, "C-1")]);
    const settled = await Promise.allSettled(
      [a1, c1].map((m) =>
        assignMatch(fx.admin, { matchId: m.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      ),
    );
    expect(settled.map(codeOf).sort()).toEqual(["OK", "TABLE_BUSY"]);
  });

  it("two matches sharing a team assigned to two tables in parallel → one TEAM_BUSY", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const [a1, a2] = await Promise.all([getMatch(fx, "A-1"), getMatch(fx, "A-2")]);
    const settled = await Promise.allSettled([
      assignMatch(fx.admin, { matchId: a1.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      assignMatch(fx.admin, { matchId: a2.id, tableId: fx.tables[1].id, expectedVersion: 0 }),
    ]);
    expect(settled.map(codeOf).sort()).toEqual(["OK", "TEAM_BUSY"]);
  });

  it("the same match assigned twice in parallel → one STALE_VERSION", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const a1 = await getMatch(fx, "A-1");
    const settled = await Promise.allSettled(
      fx.tables.map((t) => assignMatch(fx.admin, { matchId: a1.id, tableId: t.id, expectedVersion: 0 })),
    );
    expect(settled.map(codeOf).sort()).toEqual(["OK", "STALE_VERSION"]);
  });
});

describe("rollback", () => {
  it("a failure after the writes rolls back everything (match, locks, advancement, key, revision)", async () => {
    const { fx } = await buildKnockoutTournament();
    current = fx;
    const p = await proposedQf1(fx);
    const before = {
      t: await getTournament(fx),
      qf1: await getMatch(fx, "QF1"),
      sf1: await getMatch(fx, "SF1"),
      events: await db.matchEvent.count(),
      audits: await db.auditLog.count(),
      locks: await db.activeTeamMatch.count(),
    };
    const input = {
      matchId: p.matchId,
      expectedVersion: p.version,
      resultRevision: p.resultRevision,
      idempotencyKey: idemKey(),
    };
    await expect(
      confirmResult(fx.referee, input, {
        afterWork: async () => {
          throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow();

    expect(await getTournament(fx)).toEqual(before.t);
    expect(await getMatch(fx, "QF1")).toEqual(before.qf1);
    expect(await getMatch(fx, "SF1")).toEqual(before.sf1);
    expect(await db.matchEvent.count()).toBe(before.events);
    expect(await db.auditLog.count()).toBe(before.audits);
    expect(await db.activeTeamMatch.count()).toBe(before.locks);
    expect(await db.idempotencyKey.count({ where: { key: input.idempotencyKey } })).toBe(0);

    // The client retries with the same key and succeeds.
    const ok = await confirmResult(fx.referee, input);
    expect(ok.status).toBe("COMPLETED");
  });

  it("a constraint violation mid-transaction (stale lock row) leaves no partial writes", async () => {
    const fx = await buildDrawnTournament();
    current = fx;
    const a1 = await getMatch(fx, "A-1");
    const c1 = await getMatch(fx, "C-1");
    // Orphan lock row for A-1's home team: the scheduler state looks free, the PK does not.
    await db.activeTeamMatch.create({
      data: { teamId: a1.homeTeamId!, matchId: c1.id, tournamentId: fx.t.id },
    });
    const revBefore = (await getTournament(fx)).revision;
    expect(
      await errorCode(
        assignMatch(fx.admin, { matchId: a1.id, tableId: fx.tables[0].id, expectedVersion: 0 }),
      ),
    ).toBe("TEAM_BUSY");
    expect(await getMatch(fx, "A-1")).toEqual(a1);
    expect(await db.activeTeamMatch.count()).toBe(1);
    expect(await db.matchEvent.count()).toBe(0);
    expect((await getTournament(fx)).revision).toBe(revBefore);
    await db.activeTeamMatch.deleteMany();
  });
});

describe("idempotency maintenance", () => {
  it("purges keys older than the threshold", async () => {
    await db.idempotencyKey.createMany({
      data: [
        {
          key: "old-key-0001",
          userId: "u",
          scope: "s",
          requestHash: "h",
          response: {},
          createdAt: new Date(0),
        },
        { key: "new-key-0001", userId: "u", scope: "s", requestHash: "h", response: {} },
      ],
    });
    expect(await purgeIdempotencyKeys(24)).toBe(1);
    expect((await db.idempotencyKey.findMany()).map((k) => k.key)).toEqual(["new-key-0001"]);
  });
});
