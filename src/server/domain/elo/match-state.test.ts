import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { assertEloTransition, canEloTransition, isEloLive, isEloOpen } from "./match-state";
import type { EloMatchStatus } from "./types";

const ALL: EloMatchStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "VOIDED",
];

const ALLOWED = new Set([
  "DRAFT>IN_PROGRESS",
  "DRAFT>CANCELLED",
  "IN_PROGRESS>AWAITING_CONFIRMATION",
  "IN_PROGRESS>COMPLETED",
  "IN_PROGRESS>CANCELLED",
  "AWAITING_CONFIRMATION>COMPLETED",
  "AWAITING_CONFIRMATION>DISPUTED",
  "AWAITING_CONFIRMATION>VOIDED",
  "DISPUTED>COMPLETED",
  "DISPUTED>VOIDED",
  "COMPLETED>VOIDED",
]);

describe("Elo match transitions", () => {
  it("allows exactly the documented edges", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canEloTransition(from, to), `${from} → ${to}`).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
  });

  it("never leaves the terminal states and never goes back to a draft", () => {
    for (const to of ALL) {
      expect(canEloTransition("CANCELLED", to)).toBe(false);
      expect(canEloTransition("VOIDED", to)).toBe(false);
      expect(canEloTransition(to, "DRAFT")).toBe(false);
    }
  });

  it("throws INVALID_TRANSITION for anything else", () => {
    expect(() => assertEloTransition("DRAFT", "IN_PROGRESS")).not.toThrow();
    try {
      assertEloTransition("COMPLETED", "IN_PROGRESS");
      expect.unreachable();
    } catch (e) {
      expect(isDomainError(e) && e.code).toBe("INVALID_TRANSITION");
      expect((e as { details?: unknown }).details).toEqual({ from: "COMPLETED", to: "IN_PROGRESS" });
    }
  });
});

describe("status groups", () => {
  it("only drafts and running matches hold the table and the players", () => {
    expect(ALL.filter(isEloLive)).toEqual(["DRAFT", "IN_PROGRESS"]);
  });

  it("pending and disputed results still block a mode switch", () => {
    expect(ALL.filter(isEloOpen)).toEqual(["DRAFT", "IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"]);
  });
});
