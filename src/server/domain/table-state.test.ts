import { describe, expect, it } from "vitest";
import { deriveTableState } from "./table-state";

const table = { id: "t1", number: 1, isDisabled: false };

describe("deriveTableState", () => {
  it("DISABLED wins over everything", () => {
    expect(deriveTableState({ ...table, isDisabled: true }, { status: "IN_PROGRESS" })).toBe("DISABLED");
    expect(deriveTableState({ ...table, isDisabled: true }, null)).toBe("DISABLED");
  });
  it("IN_PROGRESS while playing or awaiting confirmation", () => {
    expect(deriveTableState(table, { status: "IN_PROGRESS" })).toBe("IN_PROGRESS");
    expect(deriveTableState(table, { status: "AWAITING_CONFIRMATION" })).toBe("IN_PROGRESS");
  });
  it("RESERVED when assigned", () => {
    expect(deriveTableState(table, { status: "ASSIGNED" })).toBe("RESERVED");
  });
  it("AVAILABLE without an active match", () => {
    expect(deriveTableState(table, null)).toBe("AVAILABLE");
    expect(deriveTableState(table, { status: "COMPLETED" })).toBe("AVAILABLE");
  });
});
