// Elo read models (match detail, player profile, admin lists) and the export (spec §7.3, §9.2).
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { exportEloSession, handleEloExportRequest } from "@/server/services/elo-export";
import {
  getEloMatchDetail,
  getEloPlayerProfile,
  listEloMatchesAdmin,
  listEloRuns,
} from "@/server/services/elo-read";
import { actorOf, errorCode } from "./match-fixtures";
import { eloEvent, playEloMatch, startedMatch } from "./elo-fixtures";

describe("player profile", () => {
  it("shows rating progression, recent matches, teammates and opponents", async () => {
    const fx = await eloEvent(6);
    const [a, b, c, d] = fx.players;
    await playEloMatch(fx, [a, b], [c, d], "A"); // +6
    await playEloMatch(fx, [a, c], [b, d], "B"); // a loses
    await playEloMatch(fx, [a], [d], "A", { rated: false });
    const p = (await getEloPlayerProfile(a.id, { tournamentId: fx.t.id }))!;
    expect(p).toMatchObject({
      displayName: a.displayName,
      gamesPlayed: 2,
      wins: 1,
      losses: 1,
      provisional: true,
      eligible: false,
    });
    expect(p.history.map((h) => h.sequence)).toEqual([1, 2]);
    expect(p.history[0]).toMatchObject({ delta: 6, ratingAfter: 106 });
    expect(p.history[1].ratingAfter).toBe(p.rating);
    expect(p.recentMatches.map((m) => [m.rated, m.won])).toEqual([
      [false, true],
      [true, false],
      [true, true],
    ]);
    expect(p.teammates.map((t) => [t.displayName, t.matches])).toEqual([
      [b.displayName, 1],
      [c.displayName, 1],
    ]);
    expect(p.opponents[0]).toMatchObject({ userId: d.id, matches: 3, won: 2 });
    expect(p.rank).toBeGreaterThan(0);
    // A user without games gets a neutral profile; an unknown user none.
    expect(await getEloPlayerProfile(fx.players[5].id, { tournamentId: fx.t.id })).toMatchObject({
      rating: 100,
      gamesPlayed: 0,
      rank: null,
    });
    expect(await getEloPlayerProfile("missing", { tournamentId: fx.t.id })).toBeNull();
  });
});

describe("match detail", () => {
  it("tells the whole story of a match with names, never e-mails", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    const { matchId } = await playEloMatch(fx, [a], [b], "A");
    const d = await getEloMatchDetail(matchId);
    expect(d.sides.A.map((p) => p.displayName)).toEqual([a.displayName]);
    expect(d.result).toMatchObject({ winnerSide: "A", sequence: 1, multiplier: 1, expectedScoreA: 0.5 });
    expect(d.ratingChanges.map((c) => [c.displayName, c.delta])).toEqual([
      [a.displayName, 12],
      [b.displayName, -12],
    ]);
    expect(d.events.map((e) => e.type)).toEqual([
      "CREATED",
      "CONSENTED",
      "STARTED",
      "RESULT_SUBMITTED",
      "RESULT_CONFIRMED",
    ]);
    expect(d.events[0].actorName).toBe(a.displayName);
    expect(d.revisions.map((r) => r.kind)).toEqual(["SUBMITTED", "CONFIRMED"]);
    expect(JSON.stringify(d)).not.toContain("@");
    expect(await errorCode(getEloMatchDetail("missing"))).toBe("NOT_FOUND");
  });
});

describe("admin lists and export", () => {
  it("lists matches and calculation runs for admins only", async () => {
    const fx = await eloEvent(4);
    const [a, b, c, d] = fx.players;
    await playEloMatch(fx, [a], [b], "A");
    await startedMatch(fx, [c], [d], { table: 1 });
    const rows = await listEloMatchesAdmin(actorOf(fx.admin), { sessionId: fx.session.id });
    expect(rows.map((r) => r.status)).toEqual(["IN_PROGRESS", "COMPLETED"]);
    expect(await errorCode(listEloMatchesAdmin(actorOf(fx.referee), { sessionId: fx.session.id }))).toBe(
      "FORBIDDEN",
    );
    const runs = await listEloRuns(actorOf(fx.admin), fx.session.id);
    expect(runs.map((r) => [r.revision, r.reason, r.changes, r.supersededAt])).toEqual([
      [1, "INITIAL", 2, null],
    ]);
  });

  it("exports rankings, matches, rating changes and runs as JSON and CSV", async () => {
    const fx = await eloEvent(4);
    const [a, b] = fx.players;
    await playEloMatch(fx, [a], [b], "A");
    const e = await exportEloSession(actorOf(fx.admin), { tournamentId: fx.t.id });
    expect(e.json.format).toBe("pharmapong-elo-export");
    expect(e.json.rankings.map((r) => [r.displayName, r.rank, r.ratingRounded])).toEqual([
      [a.displayName, 1, 112],
      [b.displayName, 2, 88],
    ]);
    expect(e.json.matches).toHaveLength(1);
    expect(e.json.ratingChanges).toHaveLength(2);
    expect(e.json.runs).toHaveLength(1);
    expect(e.csv.rankings.startsWith("﻿Rang;Name;Elo")).toBe(true);
    expect(e.csv.matches.split("\r\n")[1]).toContain(a.displayName);
    const all = JSON.stringify(e);
    for (const u of await db.user.findMany()) expect(all).not.toContain(u.email);
  });

  it("serves downloads to admins and refuses everyone else", async () => {
    const fx = await eloEvent(2);
    const req = (format?: string) =>
      new Request(`http://localhost/api/admin/elo-export${format ? `?format=${format}` : ""}`);
    const opts = { tournamentId: fx.t.id };
    expect((await handleEloExportRequest(req(), null, opts)).status).toBe(401);
    expect((await handleEloExportRequest(req(), actorOf(fx.referee), opts)).status).toBe(403);
    expect((await handleEloExportRequest(req("xml"), actorOf(fx.admin), opts)).status).toBe(400);
    const csv = await handleEloExportRequest(req("rankings.csv"), actorOf(fx.admin), {
      ...opts,
      now: new Date("2026-10-26T20:15:00Z"),
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Disposition")).toBe(
      'attachment; filename="pharmapong-elo-2026-10-26_21-15-00-rangliste.csv"',
    );
    await db.eloRatingRun.deleteMany();
    await db.eloSession.deleteMany();
    expect((await handleEloExportRequest(req(), actorOf(fx.admin), opts)).status).toBe(404);
  });
});
