import { describe, expect, it } from "vitest";
import { deriveEloTableState, isDraftExpired } from "./table-state";

const free = { isDisabled: false };
const NOW = 1_000_000;

describe("deriveEloTableState", () => {
  it("is AVAILABLE without a live match and DISABLED before anything else", () => {
    expect(deriveEloTableState(free, null, NOW)).toBe("AVAILABLE");
    expect(deriveEloTableState({ isDisabled: true }, null, NOW)).toBe("DISABLED");
    expect(deriveEloTableState({ isDisabled: true }, { status: "IN_PROGRESS", expiresAt: null }, NOW)).toBe(
      "DISABLED",
    );
  });

  it("shows running matches and unexpired drafts", () => {
    expect(deriveEloTableState(free, { status: "IN_PROGRESS", expiresAt: null }, NOW)).toBe("IN_PROGRESS");
    expect(deriveEloTableState(free, { status: "DRAFT", expiresAt: NOW + 1 }, NOW)).toBe("RESERVED");
    expect(deriveEloTableState(free, { status: "DRAFT", expiresAt: null }, NOW)).toBe("RESERVED");
  });

  it("frees the table as soon as a draft expires or the result was submitted", () => {
    expect(deriveEloTableState(free, { status: "DRAFT", expiresAt: NOW }, NOW)).toBe("AVAILABLE");
    expect(deriveEloTableState(free, { status: "AWAITING_CONFIRMATION", expiresAt: null }, NOW)).toBe(
      "AVAILABLE",
    );
  });
});

describe("isDraftExpired", () => {
  it("expires at the deadline, never without one", () => {
    expect(isDraftExpired(NOW, NOW)).toBe(true);
    expect(isDraftExpired(NOW + 1, NOW)).toBe(false);
    expect(isDraftExpired(null, NOW)).toBe(false);
  });
});
