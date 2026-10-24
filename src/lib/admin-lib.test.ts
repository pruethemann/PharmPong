import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  entityTypeLabel,
  formatZurich,
  matchEventLabel,
  relativeFromNow,
} from "./admin-labels";
import { knockoutBlockReasons, nextAction, stepIndex, type LifecycleInput } from "./admin-lifecycle";
import { availableMatchActions, deriveAlerts, matchesFilter, sortByPlayOrder } from "./admin-matches";
import {
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  idempotencyStorageKey,
  type KeyStorage,
} from "./admin-idempotency";
import { checkAdminResult, normalizeAdminResult, resultChanged } from "./admin-result";
import type { AuthedSnapshot, LiveMatch } from "./live-types";

describe("admin labels", () => {
  it("maps known audit actions and falls back to the raw key", () => {
    expect(auditActionLabel("match.correct")).toBe("Resultat korrigiert");
    expect(auditActionLabel("user.deactivate")).toBe("Konto deaktiviert");
    expect(auditActionLabel("x.unknown")).toBe("x.unknown");
  });
  it("maps entity types and match events", () => {
    expect(entityTypeLabel("GameTable")).toBe("Tisch");
    expect(entityTypeLabel("Other")).toBe("Other");
    expect(matchEventLabel("ISSUE_REPORTED")).toBe("Problem gemeldet");
    expect(matchEventLabel("NEW_TYPE")).toBe("NEW_TYPE");
  });
  it("formats in Europe/Zurich (summer and winter time)", () => {
    expect(formatZurich(new Date("2026-07-01T10:00:00Z"), "time")).toBe("12:00:00");
    expect(formatZurich(new Date("2026-12-01T10:00:00Z"), "time")).toBe("11:00:00");
    expect(formatZurich(null)).toBe("–");
    expect(formatZurich("not a date")).toBe("–");
  });
  it("never uses the sharp s", () => {
    const all = [auditActionLabel("match.void"), matchEventLabel("VOIDED")].join(" ");
    expect(all).not.toContain("ß");
  });
  it("relative labels", () => {
    expect(relativeFromNow(1000, 5000)).toBe("gerade eben");
    expect(relativeFromNow(0, 30_000)).toBe("vor 30 s");
    expect(relativeFromNow(0, 5 * 60_000)).toBe("vor 5 Min.");
    expect(relativeFromNow(null, 0)).toBe("–");
  });
});

const base: LifecycleInput = {
  status: "DRAFT",
  isPaused: false,
  drawExists: false,
  completeTeams: 0,
  incompleteTeams: 0,
  requiredTeams: 12,
  groupMatchesTotal: 0,
  groupMatchesDecided: 0,
  unresolvedTieGroups: [],
};

describe("lifecycle", () => {
  it("indexes steps; cancelled is off the track", () => {
    expect(stepIndex("DRAFT")).toBe(0);
    expect(stepIndex("COMPLETED")).toBe(5);
    expect(stepIndex("CANCELLED")).toBe(-1);
  });
  it("offers exactly one next action per phase", () => {
    expect(nextAction(base).kind).toBe("openRegistration");
    expect(nextAction({ ...base, status: "REGISTRATION_OPEN" }).kind).toBe("lockRegistration");
    expect(nextAction({ ...base, status: "REGISTRATION_LOCKED" }).kind).toBe("generateDraw");
    expect(nextAction({ ...base, status: "REGISTRATION_LOCKED", drawExists: true }).kind).toBe(
      "startGroupStage",
    );
    expect(nextAction({ ...base, status: "GROUP_STAGE" }).kind).toBe("startKnockout");
    expect(nextAction({ ...base, status: "KNOCKOUT_STAGE" }).kind).toBe("none");
  });
  it("lock is advisory, draw is blocked without 12 complete teams", () => {
    const lock = nextAction({ ...base, status: "REGISTRATION_OPEN", completeTeams: 10 });
    expect(lock.blocked).toBe(false);
    expect(lock.preconditions[0]).toMatchObject({
      met: false,
      advisory: true,
      label: "10/12 Teams komplett",
    });
    const draw = nextAction({ ...base, status: "REGISTRATION_LOCKED", completeTeams: 12 });
    expect(draw.blocked).toBe(false);
    expect(draw.preconditions[0].label).toBe("Auslosung: 12/12 Teams komplett");
    expect(nextAction({ ...base, status: "REGISTRATION_LOCKED", completeTeams: 11 }).blocked).toBe(true);
    expect(
      nextAction({ ...base, status: "REGISTRATION_LOCKED", completeTeams: 12, incompleteTeams: 1 }).blocked,
    ).toBe(true);
  });
  it("knockout needs all group matches and no ties", () => {
    const ko = { ...base, status: "GROUP_STAGE" as const, groupMatchesTotal: 12 };
    expect(nextAction({ ...ko, groupMatchesDecided: 11 }).blocked).toBe(true);
    expect(nextAction({ ...ko, groupMatchesDecided: 12, unresolvedTieGroups: ["B"] }).blocked).toBe(true);
    expect(nextAction({ ...ko, groupMatchesDecided: 12 }).blocked).toBe(false);
  });
  it("explains server block reasons", () => {
    expect(knockoutBlockReasons("GROUPS_INCOMPLETE", { pending: ["A-3", "B-2"] })).toEqual([
      "Noch nicht bestätigt: A-3, B-2",
    ]);
    expect(knockoutBlockReasons("UNRESOLVED_TIE", { ties: [{ group: "C" }, { group: "C" }] })).toEqual([
      "Gruppe C: Ranking-Shootout erfassen",
    ]);
    expect(knockoutBlockReasons("GROUPS_INCOMPLETE", undefined)).toHaveLength(1);
    expect(knockoutBlockReasons("OTHER", {})).toEqual([]);
  });
});

function match(p: Partial<LiveMatch>): LiveMatch {
  return {
    id: "m",
    code: "A-1",
    label: "",
    stage: "GROUP",
    round: 1,
    orderIndex: 0,
    group: "A",
    status: "PENDING",
    homeTeamId: "t1",
    awayTeamId: "t2",
    homeSource: null,
    awaySource: null,
    nextCode: null,
    tableNumber: null,
    timer: null,
    result: null,
    ...p,
  };
}

describe("admin matches", () => {
  it("filters by phase, status and open issues", () => {
    const issues = new Set(["x"]);
    expect(matchesFilter(match({ status: "IN_PROGRESS" }), "all", "active", issues)).toBe(true);
    expect(matchesFilter(match({ status: "IN_PROGRESS" }), "KNOCKOUT", "all", issues)).toBe(false);
    expect(matchesFilter(match({ status: "FORFEITED" }), "GROUP", "done", issues)).toBe(true);
    expect(matchesFilter(match({ id: "x" }), "all", "issues", issues)).toBe(true);
    expect(matchesFilter(match({ id: "y" }), "all", "issues", issues)).toBe(false);
  });
  it("offers actions by status", () => {
    const o = { hasBothTeams: true, hasOpenIssue: false };
    expect(availableMatchActions("READY", o)).toEqual(["assign", "forfeit"]);
    expect(availableMatchActions("ASSIGNED", o)).toEqual(["unassign", "abort", "forfeit"]);
    expect(availableMatchActions("AWAITING_CONFIRMATION", o)).toEqual([
      "confirm",
      "reject",
      "abort",
      "forfeit",
    ]);
    expect(availableMatchActions("COMPLETED", o)).toEqual(["correct"]);
    expect(availableMatchActions("PENDING", { hasBothTeams: false, hasOpenIssue: true })).toEqual([
      "resolveIssue",
    ]);
  });
  it("sorts by play order", () => {
    expect(
      sortByPlayOrder([match({ orderIndex: 2 }), match({ orderIndex: 1 })]).map((m) => m.orderIndex),
    ).toEqual([1, 2]);
  });
  it("derives alerts, most urgent first", () => {
    const snap = {
      matches: [
        match({ id: "a", status: "AWAITING_CONFIRMATION", code: "B-1" }),
        match({ id: "b", code: "C-2" }),
      ],
      teams: [
        { id: "t1", name: "Pipetten", motto: null, logoUrl: null, members: [] },
        { id: "t2", name: "Mörser", motto: null, logoUrl: null, members: [] },
      ],
      tournament: { isPaused: true } as AuthedSnapshot["tournament"],
      matchOps: { b: { version: 1, resultRevision: 0, proposal: null, openIssue: "Becher fehlt" } },
      admin: {
        suggestions: [],
        unresolvedTies: [{ group: "A", teamIds: ["t1", "t2"], basisHash: "h", positions: [1, 2] }],
        pendingConfirmations: 1,
      },
      tables: [{ id: "tb", number: 2, name: "Tisch 2", state: "DISABLED" as const, currentMatchId: null }],
    };
    const alerts = deriveAlerts(snap, { incompleteTeams: [{ id: "t9", name: "Solo" }] });
    expect(alerts.map((a) => a.id)).toEqual([
      "paused",
      "issue-b",
      "tie-A-h",
      "await-a",
      "table-tb",
      "incomplete-teams",
    ]);
    expect(alerts[1].href).toBe("/admin/matches?match=b");
    expect(alerts[2].detail).toContain("Pipetten, Mörser");
    expect(alerts[5].title).toBe("1 unvollständiges Team");
  });
});

function memoryStorage(): KeyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("idempotency keys", () => {
  it("reuses the key per (match, step, revision)", () => {
    const s = memoryStorage();
    let n = 0;
    const gen = () => `key-${++n}`;
    const a = getOrCreateIdempotencyKey("m1", "confirm", 1, s, gen);
    expect(getOrCreateIdempotencyKey("m1", "confirm", 1, s, gen)).toBe(a);
    expect(getOrCreateIdempotencyKey("m1", "confirm", 2, s, gen)).not.toBe(a);
    expect(s.map.has(idempotencyStorageKey("m1", "confirm", 1))).toBe(true);
    clearIdempotencyKey("m1", "confirm", 1, s);
    expect(getOrCreateIdempotencyKey("m1", "confirm", 1, s, gen)).toBe("key-3");
  });
  it("works without storage", () => {
    expect(getOrCreateIdempotencyKey("m", "s", 0, null, () => "k")).toBe("k");
  });
});

describe("admin result pre-check", () => {
  const d = {
    homeTeamId: "h",
    awayTeamId: "a",
    winnerTeamId: "h",
    homeCupsRemaining: 3,
    awayCupsRemaining: 0,
    endType: "REGULAR" as const,
  };
  it("accepts valid and rejects invalid results with a German reason", () => {
    expect(checkAdminResult(d)).toBeNull();
    expect(checkAdminResult({ ...d, awayCupsRemaining: 2 })).toMatch(/keine Becher/);
    expect(checkAdminResult({ ...d, endType: "FORFEIT", homeCupsRemaining: 0 })).toBeNull();
  });
  it("normalizes forfeits to 10:0", () => {
    expect(normalizeAdminResult({ ...d, winnerTeamId: "a", endType: "FORFEIT" })).toMatchObject({
      homeCupsRemaining: 0,
      awayCupsRemaining: 10,
    });
    expect(normalizeAdminResult(d)).toBe(d);
  });
  it("detects changes", () => {
    const cur = {
      winnerTeamId: "h",
      homeCupsRemaining: 3,
      awayCupsRemaining: 0,
      endType: "REGULAR" as const,
    };
    expect(resultChanged(d, cur)).toBe(false);
    expect(resultChanged({ ...d, homeCupsRemaining: 4 }, cur)).toBe(true);
    expect(resultChanged(d, null)).toBe(true);
  });
});

describe("redactJson", () => {
  it("removes secret keys at any depth and keeps the rest", async () => {
    const { redactJson, REDACTED } = await import("./admin-redact");
    const out = redactJson({
      passwordHash: "x",
      nested: [{ tokenHash: "y", token: "z", ok: 1 }],
      basisHash: "keep",
      sessionsRevoked: 2,
      name: "Team",
    }) as Record<string, unknown>;
    expect(out.passwordHash).toBe(REDACTED);
    expect(out.nested).toEqual([{ tokenHash: REDACTED, token: REDACTED, ok: 1 }]);
    expect(out.basisHash).toBe("keep");
    expect(out.sessionsRevoked).toBe(2);
    expect(redactJson(null)).toBeNull();
  });
});
