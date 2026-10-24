import { describe, expect, it } from "vitest";
import { matchLabel, sourceLabel } from "./live-labels";

describe("matchLabel", () => {
  it("labels group matches with group and round", () => {
    expect(matchLabel("A-1", "GROUP", 1, "A")).toBe("Gruppe A · Runde 1");
    expect(matchLabel("D-3", "GROUP", 3, "D")).toBe("Gruppe D · Runde 3");
  });

  it("labels knockout matches", () => {
    expect(matchLabel("QF1", "KNOCKOUT", 1, null)).toBe("Viertelfinal 1");
    expect(matchLabel("QF4", "KNOCKOUT", 1, null)).toBe("Viertelfinal 4");
    expect(matchLabel("SF2", "KNOCKOUT", 2, null)).toBe("Halbfinal 2");
    expect(matchLabel("F", "KNOCKOUT", 3, null)).toBe("Final");
  });

  it("falls back for unknown shapes", () => {
    expect(matchLabel("X9", "KNOCKOUT", 1, null)).toBe("X9");
    expect(matchLabel("?", "GROUP", 2, null)).toBe("Runde 2");
  });
});

describe("sourceLabel", () => {
  it("labels group placements", () => {
    expect(sourceLabel("A1")).toBe("1. Gruppe A");
    expect(sourceLabel("C2")).toBe("2. Gruppe C");
  });

  it("labels winners of earlier rounds", () => {
    expect(sourceLabel("W:QF3")).toBe("Sieger Viertelfinal 3");
    expect(sourceLabel("W:SF1")).toBe("Sieger Halbfinal 1");
  });

  it("handles empty and unknown sources", () => {
    expect(sourceLabel(null)).toBe("Offen");
    expect(sourceLabel(undefined)).toBe("Offen");
    expect(sourceLabel("E1")).toBe("E1");
  });
});
