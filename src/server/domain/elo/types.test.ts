import { describe, expect, it } from "vitest";
import {
  ELO_LIVE_STATUSES,
  ELO_OPEN_STATUSES,
  MAX_TEAM_SIZE,
  MIN_TEAM_SIZE,
  otherSide,
  SIDES,
} from "./types";

describe("Elo types", () => {
  it("names the two sides and their opposites", () => {
    expect(SIDES).toEqual(["A", "B"]);
    expect(otherSide("A")).toBe("B");
    expect(otherSide("B")).toBe("A");
  });

  it("fixes the hard team-size limits of the spec", () => {
    expect([MIN_TEAM_SIZE, MAX_TEAM_SIZE]).toEqual([1, 4]);
  });

  it("keeps live statuses a subset of open statuses", () => {
    expect(ELO_LIVE_STATUSES.every((s) => ELO_OPEN_STATUSES.includes(s))).toBe(true);
  });
});
