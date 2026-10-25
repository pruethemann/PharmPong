import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import {
  assertValidRoster,
  canonicalRoster,
  rosterIssueMessage,
  rosterIssues,
  sideOfUser,
  type RosterIssue,
} from "./roster";

describe("rosterIssues", () => {
  it("accepts 1–4 players per side, including uneven sides", () => {
    expect(rosterIssues(["a"], ["b"])).toEqual([]);
    expect(rosterIssues(["a"], ["b", "c", "d", "e"])).toEqual([]);
    expect(rosterIssues(["a", "b", "c", "d"], ["e", "f"])).toEqual([]);
  });

  it("requires at least one player on each side", () => {
    expect(rosterIssues([], ["b"])).toEqual([{ code: "SIDE_EMPTY", side: "A" }]);
    expect(rosterIssues(["a"], [])).toEqual([{ code: "SIDE_EMPTY", side: "B" }]);
  });

  it("enforces the hard maximum of 4 and narrower session limits", () => {
    expect(rosterIssues(["a", "b", "c", "d", "e"], ["f"])).toEqual([
      { code: "SIDE_TOO_LARGE", side: "A", max: 4 },
    ]);
    const pairsOnly = { minTeamSize: 2, maxTeamSize: 2 };
    expect(rosterIssues(["a"], ["b", "c"], pairsOnly)).toEqual([
      { code: "SIDE_TOO_SMALL", side: "A", min: 2 },
    ]);
    expect(rosterIssues(["a", "b"], ["c", "d", "e"], pairsOnly)).toEqual([
      { code: "SIDE_TOO_LARGE", side: "B", max: 2 },
    ]);
    // A session can never widen the hard limits.
    expect(rosterIssues(["a", "b", "c", "d", "e"], ["f"], { minTeamSize: 0, maxTeamSize: 9 })).toEqual([
      { code: "SIDE_TOO_LARGE", side: "A", max: 4 },
    ]);
  });

  it("rejects duplicates within a side and across sides", () => {
    expect(rosterIssues(["a", "a"], ["b"])).toEqual([{ code: "DUPLICATE_PLAYER", userId: "a" }]);
    expect(rosterIssues(["a"], ["b", "a"])).toEqual([{ code: "DUPLICATE_PLAYER", userId: "a" }]);
  });

  it("rejects empty player ids", () => {
    expect(rosterIssues([" "], ["b"])).toEqual([{ code: "INVALID_PLAYER_ID" }]);
  });
});

describe("rosterIssueMessage and assertValidRoster", () => {
  it("explains every issue in Swiss German", () => {
    const issues: RosterIssue[] = [
      { code: "INVALID_PLAYER_ID" },
      { code: "SIDE_EMPTY", side: "B" },
      { code: "SIDE_TOO_SMALL", side: "A", min: 2 },
      { code: "SIDE_TOO_LARGE", side: "A", max: 4 },
      { code: "DUPLICATE_PLAYER", userId: "x" },
    ];
    const messages = issues.map(rosterIssueMessage);
    expect(messages[1]).toContain("Team B");
    expect(messages[2]).toContain("mindestens 2");
    expect(messages[3]).toContain("höchstens 4");
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/ß/);
    }
  });

  it("throws VALIDATION with the first issue", () => {
    expect(() => assertValidRoster(["a"], ["b"])).not.toThrow();
    try {
      assertValidRoster([], ["b", "b"]);
      expect.unreachable();
    } catch (e) {
      expect(isDomainError(e) && e.code).toBe("VALIDATION");
      expect((e as { details?: unknown }).details).toEqual({ field: "roster", issue: "SIDE_EMPTY" });
    }
  });
});

describe("sideOfUser and canonicalRoster", () => {
  it("finds a player's side", () => {
    const roster = { sideA: ["a1", "a2"], sideB: ["b1"] };
    expect(sideOfUser(roster, "a2")).toBe("A");
    expect(sideOfUser(roster, "b1")).toBe("B");
    expect(sideOfUser(roster, "zz")).toBeNull();
  });

  it("is order-independent, includes the rated flag and does not mutate its input", () => {
    const a = ["z", "m"];
    const b = ["q", "c"];
    expect(canonicalRoster(a, b, true)).toEqual({ A: ["m", "z"], B: ["c", "q"], rated: true });
    expect(canonicalRoster(["m", "z"], ["c", "q"], true)).toEqual(canonicalRoster(a, b, true));
    expect(canonicalRoster(a, b, false)).not.toEqual(canonicalRoster(a, b, true));
    expect(a).toEqual(["z", "m"]);
  });
});
