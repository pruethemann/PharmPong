// Database-level guarantees of Elo Mode (prisma/migrations/*_elo_constraints). The services are
// the first line of defense; these constraints must hold even if a service had a bug.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { toDomainError } from "@/server/services/pg-errors";
import { makeTournament, makeUser } from "./factories";
import { makeEloMatch, makeEloSession, STARTED } from "./elo-factories";

async function setup() {
  const t = await makeTournament();
  const [table1, table2] = await db.gameTable.findMany({
    where: { tournamentId: t.id },
    orderBy: { number: "asc" },
  });
  const creator = await makeUser();
  const session = await makeEloSession(t.id);
  return { t, table1, table2, creator, session };
}

/** The DomainError code a write maps to (via pg-errors), or "OK". */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return toDomainError(e).code;
  }
}

describe("Elo sessions and rating runs", () => {
  it("defaults existing tournaments to the competitive mode", async () => {
    const t = await makeTournament();
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).gameMode).toBe("COMPETITIVE");
  });

  it("allows one non-closed session per tournament, plus closed history", async () => {
    const { t } = await setup();
    expect(await codeOf(db.eloSession.create({ data: { tournamentId: t.id, name: "Zweite" } }))).toBe(
      "INVALID_STATE",
    );
    await db.eloSession.create({ data: { tournamentId: t.id, name: "Alt", status: "CLOSED" } });
  });

  it("validates session settings", async () => {
    const t = await makeTournament();
    for (const data of [
      { minTeamSize: 0 },
      { maxTeamSize: 5 },
      { minTeamSize: 3, maxTeamSize: 2 },
      { minGamesForChampion: 101 },
      { softReminderMinutes: 0 },
      { nextSequence: 0 },
    ]) {
      await expect(
        db.eloSession.create({ data: { tournamentId: t.id, name: "x", status: "CLOSED", ...data } }),
      ).rejects.toThrow();
    }
  });

  it("validates rating parameters and keeps exactly one active run", async () => {
    const { session } = await setup();
    const run = (data: Record<string, unknown>) =>
      db.eloRatingRun.create({
        data: {
          sessionId: session.id,
          revision: 2,
          reason: "MANUAL",
          algorithmVersion: "pharmaelo-v1",
          initialRating: 100,
          kFactor: 24,
          ratingScale: 100,
          repeatMultipliers: [1, 1, 0.5, 0],
          runtime: "test",
          supersededAt: new Date(),
          ...data,
        },
      });
    for (const data of [
      { kFactor: 0 },
      { kFactor: 101 },
      { ratingScale: 5 },
      { initialRating: Number.NaN },
      { repeatMultipliers: [] },
      { repeatMultipliers: [1, 1.5] },
      { repeatMultipliers: [1, Number.NaN] },
    ]) {
      await expect(run(data)).rejects.toThrow();
    }
    // An omitted scalar list is a NULL column; the CHECK must still reject it.
    await expect(
      db.eloRatingRun.create({
        data: {
          sessionId: session.id,
          revision: 3,
          reason: "MANUAL",
          algorithmVersion: "pharmaelo-v1",
          initialRating: 100,
          kFactor: 24,
          ratingScale: 100,
          runtime: "test",
          supersededAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    // A second *active* run (supersededAt null) is rejected; a superseded one is fine.
    await expect(run({ supersededAt: null })).rejects.toThrow();
    await run({});
  });
});

describe("Elo matches", () => {
  it("lets a table host only one live (draft or running) match", async () => {
    const { table1, table2, creator, session } = await setup();
    const first = await makeEloMatch(session.id, table1.id, creator.id);
    expect(await codeOf(makeEloMatch(session.id, table1.id, creator.id))).toBe("TABLE_BUSY");
    await makeEloMatch(session.id, table2.id, creator.id); // the other table is free
    // A submitted result frees the table for the next group.
    await db.eloMatch.update({
      where: { id: first.id },
      data: {
        ...STARTED,
        status: "AWAITING_CONFIRMATION",
        winnerSide: "A",
        endType: "REGULAR",
        endedAt: new Date(),
        submittedAt: new Date(),
        submittedSide: "A",
      },
    });
    await makeEloMatch(session.id, table1.id, creator.id);
  });

  it("keeps a player in at most one live match", async () => {
    const { table1, table2, creator, session } = await setup();
    const a = await makeEloMatch(session.id, table1.id, creator.id);
    const b = await makeEloMatch(session.id, table2.id, creator.id);
    await db.eloActivePlayer.create({ data: { userId: creator.id, matchId: a.id, sessionId: session.id } });
    expect(
      await codeOf(
        db.eloActivePlayer.create({ data: { userId: creator.id, matchId: b.id, sessionId: session.id } }),
      ),
    ).toBe("PLAYER_BUSY");
  });

  it("allows 1–4 positions per side and every player only once", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id);
    const [u2, u3] = await Promise.all([makeUser(), makeUser()]);
    await db.eloMatchParticipant.create({
      data: { matchId: m.id, userId: creator.id, side: "A", position: 1 },
    });
    for (const data of [
      { userId: u2.id, side: "B" as const, position: 5 },
      { userId: u2.id, side: "A" as const, position: 1 }, // position taken
      { userId: creator.id, side: "B" as const, position: 1 }, // already on side A
    ]) {
      await expect(db.eloMatchParticipant.create({ data: { matchId: m.id, ...data } })).rejects.toThrow();
    }
    await db.eloMatchParticipant.create({ data: { matchId: m.id, userId: u3.id, side: "B", position: 1 } });
  });

  it("cannot leave the draft without both consents matching the roster", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id);
    const start = (data: Record<string, unknown>) =>
      db.eloMatch.update({
        where: { id: m.id },
        data: { status: "IN_PROGRESS", startedAt: new Date(), ...data },
      });
    await expect(start({})).rejects.toThrow();
    await expect(start({ consentAHash: "roster-1", consentBHash: "older-roster" })).rejects.toThrow();
    await start({ consentAHash: "roster-1", consentBHash: "roster-1" });
    // ... and cancelling an unconsented draft is always possible.
    const other = await makeEloMatch(
      session.id,
      (await db.gameTable.findFirstOrThrow({ where: { number: 2, tournamentId: session.tournamentId } })).id,
      creator.id,
    );
    await db.eloMatch.update({ where: { id: other.id }, data: { status: "CANCELLED" } });
  });

  it("requires a complete result for pending, disputed and completed matches", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id, STARTED);
    const set = (data: Record<string, unknown>) => db.eloMatch.update({ where: { id: m.id }, data });
    const result = { winnerSide: "A" as const, endType: "REGULAR" as const, endedAt: new Date() };
    await expect(set({ status: "AWAITING_CONFIRMATION", ...result })).rejects.toThrow(); // no submission
    await expect(set({ status: "COMPLETED", ...result, confirmedAt: new Date() })).rejects.toThrow(); // no sequence
    await expect(
      set({ status: "DISPUTED", ...result, submittedAt: new Date(), submittedSide: "A" }),
    ).rejects.toThrow();
    await expect(
      set({ status: "COMPLETED", confirmedAt: new Date(), confirmedSequence: 1 }),
    ).rejects.toThrow(); // no winner
    await set({ status: "COMPLETED", ...result, confirmedAt: new Date(), confirmedSequence: 1 });
    // The confirmation sequence is unique per session.
    const n = await makeEloMatch(session.id, table1.id, creator.id, STARTED);
    await expect(
      db.eloMatch.update({
        where: { id: n.id },
        data: { status: "COMPLETED", ...result, confirmedAt: new Date(), confirmedSequence: 1 },
      }),
    ).rejects.toThrow();
  });

  it("checks cups, the clock and rating bookkeeping", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id);
    for (const data of [
      { cupsRemainingA: 11 },
      { cupsRemainingB: -1 },
      { pausedDurationMs: -5 },
      { pausedAt: new Date() }, // paused only while running
      { ratingMultiplier: 1.5 },
      { expectedScoreA: -0.1 },
      { version: -1 },
    ]) {
      await expect(db.eloMatch.update({ where: { id: m.id }, data })).rejects.toThrow();
    }
  });
});

describe("Elo ratings and history", () => {
  it("keeps the projection consistent", async () => {
    const { creator, session } = await setup();
    const base = {
      sessionId: session.id,
      userId: creator.id,
      rating: 106,
      lowestRating: 100,
      peakRating: 106,
    };
    await expect(
      db.eloPlayerRating.create({ data: { ...base, gamesPlayed: 1, wins: 1, losses: 1 } }),
    ).rejects.toThrow();
    await expect(
      db.eloPlayerRating.create({ data: { ...base, rating: Number.NaN, gamesPlayed: 0 } }),
    ).rejects.toThrow();
    await expect(
      db.eloPlayerRating.create({ data: { ...base, rating: 2e9, gamesPlayed: 0 } }),
    ).rejects.toThrow();
    await db.eloPlayerRating.create({ data: { ...base, gamesPlayed: 1, wins: 1 } });
  });

  it("validates rating changes", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id);
    const run = await db.eloRatingRun.findFirstOrThrow({ where: { sessionId: session.id } });
    const change = (data: Record<string, unknown>) =>
      db.eloRatingChange.create({
        data: {
          runId: run.id,
          runRevision: 1,
          matchId: m.id,
          userId: creator.id,
          side: "A",
          sequence: 1,
          ratingBefore: 100,
          delta: 6,
          ratingAfter: 106,
          expectedScore: 0.5,
          teamSize: 2,
          opponentTeamSize: 2,
          multiplier: 1,
          algorithmVersion: "pharmaelo-v1",
          ...data,
        },
      });
    for (const data of [
      { expectedScore: 1.2 },
      { multiplier: 2 },
      { teamSize: 5 },
      { delta: Infinity },
      { sequence: 0 },
    ]) {
      await expect(change(data)).rejects.toThrow();
    }
    await change({});
    await expect(change({})).rejects.toThrow(); // one row per (run, match, player)
  });

  it("rejects impossible result revisions", async () => {
    const { table1, creator, session } = await setup();
    const m = await makeEloMatch(session.id, table1.id, creator.id);
    const revision = (data: Record<string, unknown>) =>
      db.eloMatchResultRevision.create({
        data: {
          matchId: m.id,
          revision: 1,
          kind: "CONFIRMED",
          status: "COMPLETED",
          winnerSide: "A",
          rated: true,
          sideA: ["x"],
          sideB: ["y"],
          ...data,
        },
      });
    for (const data of [
      { sideA: [] },
      { sideB: ["a", "b", "c", "d", "e"] },
      { sideA: ["x", "z"], sideB: ["z"] }, // z on both sides
      { winnerSide: null },
      { cupsRemainingA: 12 },
      { revision: 0 },
    ]) {
      await expect(revision(data)).rejects.toThrow();
    }
    await expect(
      db.eloMatchResultRevision.create({
        data: {
          matchId: m.id,
          revision: 3,
          kind: "CONFIRMED",
          status: "COMPLETED",
          winnerSide: "A",
          rated: true,
        },
      }),
    ).rejects.toThrow(); // NULL rosters
    await revision({ kind: "VOIDED", status: "VOIDED", winnerSide: null, revision: 2 });
    await revision({});
  });
});
