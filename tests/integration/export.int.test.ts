// Tournament export (JSON + CSV) and GET /api/admin/export handler.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { ensureTournament } from "@/server/services/bootstrap";
import {
  CSV_SEPARATOR,
  exportTimestamp,
  exportTournament,
  formatZurich,
  handleExportRequest,
  toCsv,
} from "@/server/services/export";
import { ensureSimAdmin, simulateTournament } from "@/server/sim/simulate-tournament";
import { makeUser } from "./factories";

const actorOf = (u: { id: string; email: string; displayName: string; role: Actor["role"] }): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

async function simulated() {
  const tournamentId = await ensureTournament(db);
  const report = await simulateTournament({ seed: 3, tournamentId, demoPassword: "simulation-pass-123" });
  const admin = await ensureSimAdmin(db);
  return { tournamentId, report, admin };
}

const url = (q: string) => new Request(`http://localhost/api/admin/export${q}`);

describe("exportTournament", () => {
  it("exports a completed tournament: 19 matches, standings, champion, no private data", async () => {
    const { tournamentId, report, admin } = await simulated();
    const out = await exportTournament(admin, tournamentId);
    const { json } = out;

    expect(out.tournamentId).toBe(tournamentId);
    expect(json.tournament.status).toBe("COMPLETED");
    expect(json.tournament.champion).toEqual({ id: report.championTeamId, name: report.championName });
    expect(json.matches).toHaveLength(19);
    expect(json.teams).toHaveLength(12);
    expect(json.teams.every((t) => t.members.length === 2 && t.group !== null)).toBe(true);
    expect(json.groups.map((g) => g.name)).toEqual(["A", "B", "C", "D"]);
    expect(json.groups.every((g) => g.complete && g.standings.length === 3)).toBe(true);
    expect(json.groups[0].tiebreaks).toHaveLength(1);
    expect(json.auditCount).toBe(await db.auditLog.count({ where: { tournamentId } }));

    for (const m of json.matches) {
      expect(m.result, m.code).not.toBeNull();
      expect(m.homeTeam?.name, m.code).toBeTruthy();
      expect(m.awayTeam?.name, m.code).toBeTruthy();
      expect(m.startedAt?.iso, m.code).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(m.startedAt?.local, m.code).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/);
      expect(m.table, m.code).toBeOneOf([1, 2]);
    }
    expect(json.matches.find((m) => m.code === "QF1")?.corrections).toBe(1);
    expect(json.matches.find((m) => m.code === "F")?.result?.winner?.id).toBe(report.championTeamId);

    // No e-mail addresses, hashes, invite codes or sessions anywhere.
    const all = JSON.stringify(json) + out.csv.standings + out.csv.matches;
    expect(all).not.toContain("@");
    expect(all).not.toMatch(/passwordHash|inviteCode|email|\$argon2/i);
    const codes = await db.team.findMany({ where: { tournamentId }, select: { inviteCode: true } });
    for (const c of codes) expect(all).not.toContain(c.inviteCode);
  }, 120_000);

  it("writes semicolon CSVs with BOM, headers and one row per standing / match", async () => {
    const { tournamentId, admin } = await simulated();
    const { csv, json } = await exportTournament(admin, tournamentId);
    for (const text of [csv.standings, csv.matches]) {
      expect(text.startsWith("﻿")).toBe(true);
      expect(text.endsWith("\r\n")).toBe(true);
    }
    const standings = csv.standings.slice(1).trimEnd().split("\r\n");
    expect(standings).toHaveLength(1 + 12);
    expect(standings[0].split(CSV_SEPARATOR)[0]).toBe("Gruppe");
    const matches = csv.matches.slice(1).trimEnd().split("\r\n");
    expect(matches).toHaveLength(1 + 19);
    expect(matches[0].split(CSV_SEPARATOR)).toContain("Becher Heim");
    const f = matches.find((l) => l.startsWith("F;"))!;
    expect(f).toContain(json.tournament.champion!.name);
    // Negative cup differences stay numbers (no formula escaping for numeric cells).
    expect(csv.standings).toMatch(/;-\d+;/);
  }, 120_000);

  it("escapes formula-like text and quotes separators in CSV cells", () => {
    const text = toCsv(
      ["Team", "Diff"],
      [
        ['=HYPERLINK("x";"y")', -3],
        ["@cmd", 0],
        ["Pipettierer; die Echten", null],
      ],
    );
    expect(text).toBe(
      '\uFEFFTeam;Diff\r\n"\'=HYPERLINK(""x"";""y"")";-3\r\n\'@cmd;0\r\n"Pipettierer; die Echten";\r\n',
    );
  });

  it("is admin only", async () => {
    const tournamentId = await ensureTournament(db);
    const player = actorOf(await makeUser({ role: "PLAYER" }));
    const referee = actorOf(await makeUser({ role: "REFEREE" }));
    await expect(exportTournament(player, tournamentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportTournament(referee, tournamentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("formats Zurich time with daylight saving", () => {
    expect(formatZurich(new Date("2026-07-01T12:00:00Z"))).toBe("01.07.2026, 14:00:00");
    expect(formatZurich(new Date("2026-12-01T12:00:00Z"))).toBe("01.12.2026, 13:00:00");
    expect(formatZurich(null)).toBeNull();
    expect(exportTimestamp(new Date("2026-10-24T09:03:05Z"))).toBe("2026-10-24_11-03-05");
  });
});

describe("GET /api/admin/export handler", () => {
  it("returns 401 without a session and 403 for players and referees", async () => {
    await ensureTournament(db);
    expect((await handleExportRequest(url("?format=json"), null)).status).toBe(401);
    for (const role of ["PLAYER", "REFEREE"] as const) {
      const res = await handleExportRequest(url("?format=json"), actorOf(await makeUser({ role })));
      expect(res.status, role).toBe(403);
      expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    }
  });

  it("serves json / standings.csv / matches.csv as downloads for admins", async () => {
    const { tournamentId, admin } = await simulated();
    const now = new Date("2026-10-24T18:30:00Z");

    const json = await handleExportRequest(url(""), admin, { now });
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Type")).toContain("application/json");
    expect(json.headers.get("Content-Disposition")).toBe(
      'attachment; filename="pharmapong-export-2026-10-24_20-30-00.json"',
    );
    expect(json.headers.get("Cache-Control")).toBe("no-store");
    const body = await json.text();
    expect(body).not.toContain("@");
    expect(JSON.parse(body).matches).toHaveLength(19);

    const standings = await handleExportRequest(url("?format=standings.csv"), admin, { now });
    expect(standings.headers.get("Content-Type")).toContain("text/csv");
    expect(standings.headers.get("Content-Disposition")).toContain("-standings.csv");
    expect((await standings.text()).split("\r\n").filter(Boolean)).toHaveLength(13);

    const matches = await handleExportRequest(
      url(`?format=matches.csv&tournamentId=${tournamentId}`),
      admin,
      {
        now,
      },
    );
    expect(matches.headers.get("Content-Disposition")).toContain("-matches.csv");
    expect((await matches.text()).split("\r\n").filter(Boolean)).toHaveLength(20);
  }, 120_000);

  it("rejects unknown formats (400) and unknown tournaments (404)", async () => {
    await ensureTournament(db);
    const admin = await ensureSimAdmin(db);
    expect((await handleExportRequest(url("?format=xlsx"), admin)).status).toBe(400);
    expect((await handleExportRequest(url("?tournamentId=nope"), admin)).status).toBe(404);
  });

  it("returns 404 when no tournament exists", async () => {
    const admin = await ensureSimAdmin(db);
    expect((await handleExportRequest(url("?format=json"), admin)).status).toBe(404);
  });
});
