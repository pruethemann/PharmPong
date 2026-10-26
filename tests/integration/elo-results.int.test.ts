// Elo results through the real services (spec §6): show and confirm, disputes, staff decisions,
// referee-only policy, voiding, friendlies, repeat multipliers and idempotent retries.
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { updateEloSettings } from "@/server/services/elo-session";
import {
  confirmEloResult,
  disputeEloResult,
  staffFinalizeEloResult,
  submitEloResult,
  voidEloResult,
} from "@/server/services/elo-results";
import { makeUser } from "./factories";
import { actorOf, errorCode, idemKey } from "./match-fixtures";
import {
  assertEloInvariants,
  draftMatch,
  eloEvent,
  matchRow,
  playEloMatch,
  ratingOf,
  startedMatch,
  type EloFx,
} from "./elo-fixtures";
import type { User } from "@/generated/prisma/client";
import { startEloMatch } from "@/server/services/elo-matches";

let fx: EloFx | null = null;
afterEach(async () => {
  if (fx) await assertEloInvariants(fx.session.id);
  fx = null;
});

async function submit(user: User, matchId: string, winnerSide: "A" | "B", key = idemKey()) {
  const m = await matchRow(matchId);
  return submitEloResult(actorOf(user), {
    matchId,
    expectedVersion: m.version,
    winnerSide,
    endType: "REGULAR",
    idempotencyKey: key,
  });
}

describe("show and confirm", () => {
  it("lets the reporting side amend until the other side confirms the shown result", async () => {
    fx = await eloEvent();
    const [a1, a2, b1] = fx.players;
    const matchId = await startedMatch(fx, [a1, a2], [b1]);
    const first = await submit(a1, matchId, "B"); // mis-tap
    const amended = await submit(a2, matchId, "A"); // teammate fixes it
    expect(amended.resultVersion).toBe(first.resultVersion + 1);
    // Confirming the outdated report is refused.
    expect(
      await errorCode(
        confirmEloResult(actorOf(b1), {
          matchId,
          resultVersion: first.resultVersion,
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("STALE_VERSION");
    const ok = await confirmEloResult(actorOf(b1), {
      matchId,
      resultVersion: amended.resultVersion,
      idempotencyKey: idemKey(),
    });
    expect(ok.status).toBe("COMPLETED");
    expect((await matchRow(matchId)).winnerSide).toBe("A");
    expect(
      (await db.eloMatchResultRevision.findMany({ where: { matchId }, orderBy: { revision: "asc" } })).map(
        (r) => r.kind,
      ),
    ).toEqual(["SUBMITTED", "AMENDED", "CONFIRMED"]);
  });

  it("never lets anyone confirm for both sides", async () => {
    fx = await eloEvent();
    const [a1, a2, b1] = fx.players;
    const matchId = await startedMatch(fx, [a1, a2], [b1]);
    const s = await submit(a1, matchId, "A");
    for (const u of [a1, a2]) {
      expect(
        await errorCode(
          confirmEloResult(actorOf(u), {
            matchId,
            resultVersion: s.resultVersion,
            idempotencyKey: idemKey(),
          }),
        ),
      ).toBe("FORBIDDEN");
    }
    // The other side cannot amend the report either; it confirms or objects.
    expect(await errorCode(submit(b1, matchId, "B"))).toBe("FORBIDDEN");
    expect(
      await errorCode(
        confirmEloResult(actorOf(fx.referee), {
          matchId,
          resultVersion: s.resultVersion,
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("does not let a referee or admin who plays use staff powers in their own match", async () => {
    fx = await eloEvent();
    const [a1, b1] = fx.players;
    const playingAdmin = await makeUser({ role: "ADMIN" });
    const matchId = await startedMatch(fx, [a1, fx.referee], [b1, playingAdmin]);
    const m = await matchRow(matchId);
    for (const staff of [fx.referee, playingAdmin]) {
      expect(
        await errorCode(
          staffFinalizeEloResult(actorOf(staff), {
            matchId,
            expectedVersion: m.version,
            winnerSide: "A",
            endType: "REGULAR",
            idempotencyKey: idemKey(),
          }),
        ),
      ).toBe("FORBIDDEN");
    }
    // ... but they report and confirm like any participant.
    const s = await submit(fx.referee, matchId, "A");
    const ok = await confirmEloResult(actorOf(playingAdmin), {
      matchId,
      resultVersion: s.resultVersion,
      idempotencyKey: idemKey(),
    });
    expect(ok.status).toBe("COMPLETED");
  });
});

describe("disputes and staff decisions", () => {
  it("keeps disputed matches out of the ratings until staff resolve them, numbered at resolution", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const disputed = await startedMatch(fx, [a], [b], { table: 0 });
    const s = await submit(a, disputed, "A");
    await disputeEloResult(actorOf(b), {
      matchId: disputed,
      resultVersion: s.resultVersion,
      note: "Wir haben gewonnen",
      idempotencyKey: idemKey(),
    });
    let m = await matchRow(disputed);
    expect(m).toMatchObject({
      status: "DISPUTED",
      confirmedSequence: null,
      disputeNote: "Wir haben gewonnen",
    });
    expect(await db.eloRatingChange.count({ where: { matchId: disputed } })).toBe(0);
    expect(await ratingOf(fx.session.id, a)).toBe(100);
    // Meanwhile another match is confirmed: it takes sequence 1.
    const other = await playEloMatch(fx, [c], [d], "A", { table: 1 });
    expect(other.confirmed.confirmed!.sequence).toBe(1);
    // Players cannot resolve; staff need a reason.
    expect(
      await errorCode(
        staffFinalizeEloResult(actorOf(a), {
          matchId: disputed,
          expectedVersion: m.version,
          winnerSide: "A",
          endType: "REGULAR",
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        staffFinalizeEloResult(actorOf(fx.referee), {
          matchId: disputed,
          expectedVersion: m.version,
          winnerSide: "B",
          endType: "REGULAR",
          idempotencyKey: idemKey(),
        }),
      ),
    ).toBe("VALIDATION");
    const resolved = await staffFinalizeEloResult(actorOf(fx.referee), {
      matchId: disputed,
      expectedVersion: m.version,
      winnerSide: "B",
      endType: "REGULAR",
      reason: "Video gesichtet",
      idempotencyKey: idemKey(),
    });
    expect(resolved.confirmed!.sequence).toBe(2);
    m = await matchRow(disputed);
    expect(m).toMatchObject({ status: "COMPLETED", winnerSide: "B", confirmedById: fx.referee.id });
    expect(await ratingOf(fx.session.id, b)).toBe(112);
    expect(
      await db.auditLog.count({ where: { action: { in: ["elo.match.dispute", "elo.match.resolve"] } } }),
    ).toBe(2);
  });

  it("lets non-participating staff decide a running match directly", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const matchId = await startedMatch(fx, [a], [b]);
    const m = await matchRow(matchId);
    const r = await staffFinalizeEloResult(actorOf(fx.admin), {
      matchId,
      expectedVersion: m.version,
      winnerSide: "B",
      endType: "CONCEDED",
      idempotencyKey: idemKey(),
    });
    expect(r.confirmed).toMatchObject({ sequence: 1, effective: true });
    expect(await db.eloActivePlayer.count()).toBe(0);
    const after = await matchRow(matchId);
    expect(after.endedAt).not.toBeNull();
    expect(after.submittedSide).toBeNull();
  });

  it("voids a pending result without any rating effect", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const matchId = await startedMatch(fx, [a], [b]);
    await submit(a, matchId, "A");
    const m = await matchRow(matchId);
    expect(
      await errorCode(voidEloResult(actorOf(b), { matchId, expectedVersion: m.version, reason: "Unfug" })),
    ).toBe("FORBIDDEN");
    await voidEloResult(actorOf(fx.referee), {
      matchId,
      expectedVersion: m.version,
      reason: "Spiel nicht beendet",
    });
    expect(await matchRow(matchId)).toMatchObject({ status: "VOIDED", confirmedSequence: null });
    expect(await db.eloPlayerRating.count()).toBe(0);
  });

  it("supports the referee-only policy, copied onto the match when it is created", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const before = await startedMatch(fx, [c], [d], { table: 1 }); // created under DUAL_TEAM
    const s = await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    await updateEloSettings(
      actorOf(fx.admin),
      {
        sessionId: s.id,
        expectedConfigVersion: s.configVersion,
        settings: {
          minTeamSize: 1,
          maxTeamSize: 4,
          minGamesForChampion: 3,
          softReminderMinutes: null,
          resultPolicy: "REFEREE_ONLY",
        },
      },
      fx.opts,
    );
    const matchId = await startedMatch(fx, [a], [b], { table: 0 });
    const r = await submit(a, matchId, "A");
    expect(
      await errorCode(
        confirmEloResult(actorOf(b), { matchId, resultVersion: r.resultVersion, idempotencyKey: idemKey() }),
      ),
    ).toBe("FORBIDDEN");
    const m = await matchRow(matchId);
    await staffFinalizeEloResult(actorOf(fx.referee), {
      matchId,
      expectedVersion: m.version,
      winnerSide: "A",
      endType: "REGULAR",
      idempotencyKey: idemKey(),
    });
    // The older match keeps its policy: the other side may still confirm it.
    const r2 = await submit(c, before, "B");
    expect(
      (
        await confirmEloResult(actorOf(d), {
          matchId: before,
          resultVersion: r2.resultVersion,
          idempotencyKey: idemKey(),
        })
      ).status,
    ).toBe("COMPLETED");
  });
});

describe("rating rules through the services", () => {
  it("records friendlies without Elo and applies the repeat schedule 100/100/50/0", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const friendly = await playEloMatch(fx, [a], [b], "A", { rated: false });
    expect(friendly.confirmed.confirmed).toMatchObject({
      rated: false,
      multiplier: null,
      effective: false,
      changes: [],
    });
    expect((await matchRow(friendly.matchId)).confirmedSequence).toBe(1);
    const multipliers: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await playEloMatch(fx, [a, c], [b, d], i % 2 === 0 ? "A" : "B");
      multipliers.push(r.confirmed.confirmed!.multiplier);
    }
    expect(multipliers).toEqual([1, 1, 0.5, 0]);
    const ra = await db.eloPlayerRating.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: fx.session.id, userId: a.id } },
    });
    expect(ra.gamesPlayed).toBe(3); // the friendly and the unrated 4th meeting do not count
  });

  it("splits uneven teams as in spec example B", async () => {
    fx = await eloEvent();
    const [solo, ...four] = fx.players;
    const r = await playEloMatch(fx, [solo], four.slice(0, 4), "A");
    expect(r.confirmed.confirmed!.changes.map((c) => c.delta)).toEqual([12, -3, -3, -3, -3]);
  });
});

describe("idempotency and concurrency", () => {
  it("replays a retried confirmation instead of rating twice", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const matchId = await startedMatch(fx, [a], [b]);
    const s = await submit(a, matchId, "A");
    const key = idemKey();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        confirmEloResult(actorOf(b), { matchId, resultVersion: s.resultVersion, idempotencyKey: key }),
      ),
    );
    const ok = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<unknown>).value);
    expect(ok).toHaveLength(5);
    for (const v of ok) expect(v).toEqual(ok[0]);
    expect(await db.eloRatingChange.count({ where: { matchId } })).toBe(2);
    expect((await db.eloSession.findUniqueOrThrow({ where: { id: fx.session.id } })).nextSequence).toBe(2);
    // The same key with a different request is refused.
    expect(
      await errorCode(
        confirmEloResult(actorOf(b), { matchId, resultVersion: s.resultVersion + 5, idempotencyKey: key }),
      ),
    ).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("lets only one of two simultaneous confirmations from the same side win", async () => {
    fx = await eloEvent();
    const [a, b1, b2] = fx.players;
    const matchId = await startedMatch(fx, [a], [b1, b2]);
    const s = await submit(a, matchId, "A");
    const results = await Promise.allSettled(
      [b1, b2].map((u) =>
        confirmEloResult(actorOf(u), { matchId, resultVersion: s.resultVersion, idempotencyKey: idemKey() }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.eloRatingChange.count({ where: { matchId } })).toBe(3);
  });

  it("runs two matches at the same time on both tables", async () => {
    fx = await eloEvent();
    const [a, b, c, d] = fx.players;
    const [m1, m2] = await Promise.all([
      startedMatch(fx, [a], [b], { table: 0 }),
      startedMatch(fx, [c], [d], { table: 1 }),
    ]);
    expect((await db.eloMatch.findMany({ where: { status: "IN_PROGRESS" } })).length).toBe(2);
    await Promise.all([submit(a, m1, "A"), submit(c, m2, "B")]);
    const pending = await db.eloMatch.findMany({ where: { id: { in: [m1, m2] } } });
    await Promise.all(
      pending.map((m) =>
        confirmEloResult(actorOf(m.id === m1 ? b : d), {
          matchId: m.id,
          resultVersion: m.resultVersion,
          idempotencyKey: idemKey(),
        }),
      ),
    );
    const seqs = (await db.eloMatch.findMany({ where: { id: { in: [m1, m2] } } }))
      .map((m) => m.confirmedSequence)
      .sort();
    expect(seqs).toEqual([1, 2]);
  });

  it("refuses a second start of the same draft", async () => {
    fx = await eloEvent();
    const [a, b] = fx.players;
    const { matchId } = await draftMatch(fx, [a], [b]);
    const m = await matchRow(matchId);
    const results = await Promise.allSettled(
      [a, b].map((u) => startEloMatch(actorOf(u), { matchId, expectedVersion: m.version })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
