import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { validateEloResult, type EloResultInput } from "./result-rules";

function reasonOf(input: EloResultInput): string {
  try {
    validateEloResult(input);
    return "OK";
  } catch (e) {
    if (!isDomainError(e)) throw e;
    expect(e.code).toBe("INVALID_RESULT");
    expect(e.message).not.toMatch(/ß/);
    return String((e.details as { reason?: string }).reason);
  }
}

describe("validateEloResult", () => {
  it("accepts a winner without cup counts and normalizes them to null", () => {
    expect(validateEloResult({ winnerSide: "B", endType: "REGULAR" })).toEqual({
      winnerSide: "B",
      endType: "REGULAR",
      cupsRemainingA: null,
      cupsRemainingB: null,
    });
  });

  it("accepts consistent optional cups", () => {
    expect(reasonOf({ winnerSide: "A", endType: "REGULAR", cupsRemainingA: 3, cupsRemainingB: 0 })).toBe(
      "OK",
    );
    expect(reasonOf({ winnerSide: "A", endType: "REGULAR", cupsRemainingA: 4 })).toBe("OK");
    expect(reasonOf({ winnerSide: "B", endType: "CONCEDED", cupsRemainingA: 6, cupsRemainingB: 2 })).toBe(
      "OK",
    );
  });

  it("never accepts a draw or an unknown end type", () => {
    expect(reasonOf({ winnerSide: "DRAW" as "A", endType: "REGULAR" })).toBe("NO_WINNER");
    expect(reasonOf({ winnerSide: "A", endType: "TIME_LIMIT" as "REGULAR" })).toBe("UNKNOWN_END_TYPE");
  });

  it("checks cup counts", () => {
    for (const bad of [-1, 11, 2.5, Number.NaN]) {
      expect(reasonOf({ winnerSide: "A", endType: "CONCEDED", cupsRemainingA: bad })).toBe(
        "CUPS_OUT_OF_RANGE",
      );
    }
    expect(reasonOf({ winnerSide: "A", endType: "REGULAR", cupsRemainingA: 0 })).toBe("WINNER_NO_CUPS");
    expect(reasonOf({ winnerSide: "B", endType: "REGULAR", cupsRemainingA: 2, cupsRemainingB: 5 })).toBe(
      "REGULAR_LOSER_HAS_CUPS",
    );
  });
});
