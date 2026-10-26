import { describe, expect, it } from "vitest";
import { repeatRuleLines } from "./de-elo";

describe("repeat-match rule in words", () => {
  it("groups equal multipliers and ends with an open range", () => {
    expect(repeatRuleLines([1, 1, 0.5, 0])).toEqual([
      "1. und 2. Begegnung: zählt voll",
      "3. Begegnung: zählt zur Hälfte",
      "ab der 4. Begegnung: zählt nicht mehr",
    ]);
    expect(repeatRuleLines([1, 1, 1, 0.25])).toEqual([
      "1. bis 3. Begegnung: zählt voll",
      "ab der 4. Begegnung: zählt zu 25\u00a0%",
    ]);
  });

  it("describes a disabled rule in one line", () => {
    expect(repeatRuleLines([1])).toEqual(["Jede Begegnung zählt voll"]);
    expect(repeatRuleLines([1, 1])).toEqual(["Jede Begegnung zählt voll"]);
    expect(repeatRuleLines([])).toEqual([]);
  });
});
