import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { assertMatchTransition, canMatchTransition, isActiveStatus, isDecidedStatus } from "./match-state";
import type { MatchStatus } from "./types";

const ALL: MatchStatus[] = [
  "PENDING",
  "READY",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
  "FORFEITED",
];
const key = (a: string, b: string) => `${a}>${b}`;
const NORMAL = [
  "PENDING>READY",
  "READY>ASSIGNED",
  "ASSIGNED>READY",
  "ASSIGNED>IN_PROGRESS",
  "IN_PROGRESS>AWAITING_CONFIRMATION",
  "AWAITING_CONFIRMATION>IN_PROGRESS",
  "AWAITING_CONFIRMATION>COMPLETED",
  "READY>FORFEITED",
  "ASSIGNED>FORFEITED",
  "IN_PROGRESS>FORFEITED",
  "AWAITING_CONFIRMATION>FORFEITED",
  "PENDING>CANCELLED",
  "READY>CANCELLED",
  "ASSIGNED>CANCELLED",
  "IN_PROGRESS>CANCELLED",
  "AWAITING_CONFIRMATION>CANCELLED",
];
const RECOVERY = [
  "COMPLETED>READY",
  "FORFEITED>READY",
  "COMPLETED>PENDING",
  "FORFEITED>PENDING",
  "READY>PENDING",
  "ASSIGNED>PENDING",
  "IN_PROGRESS>PENDING",
  "AWAITING_CONFIRMATION>PENDING",
  "IN_PROGRESS>READY",
  "AWAITING_CONFIRMATION>READY",
];

describe("canMatchTransition", () => {
  it("matches the normal edge table exactly", () => {
    const allowed = new Set(NORMAL);
    for (const f of ALL)
      for (const t of ALL) expect(canMatchTransition(f, t), key(f, t)).toBe(allowed.has(key(f, t)));
  });
  it("matches the recovery edge table exactly", () => {
    const allowed = new Set([...NORMAL, ...RECOVERY]);
    for (const f of ALL) {
      for (const t of ALL) {
        expect(canMatchTransition(f, t, { recovery: true }), key(f, t)).toBe(allowed.has(key(f, t)));
      }
    }
  });
  it("cannot complete without a proposal or skip assignment", () => {
    expect(canMatchTransition("IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(canMatchTransition("READY", "IN_PROGRESS")).toBe(false);
    expect(canMatchTransition("CANCELLED", "READY", { recovery: true })).toBe(false);
  });
});

describe("assertMatchTransition", () => {
  it("passes or throws INVALID_TRANSITION", () => {
    expect(() => assertMatchTransition("PENDING", "READY")).not.toThrow();
    expect(() => assertMatchTransition("COMPLETED", "READY", { recovery: true })).not.toThrow();
    try {
      assertMatchTransition("COMPLETED", "READY");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

describe("status predicates", () => {
  it("isActiveStatus", () => {
    expect(ALL.filter(isActiveStatus)).toEqual(["ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION"]);
  });
  it("isDecidedStatus", () => {
    expect(ALL.filter(isDecidedStatus)).toEqual(["COMPLETED", "FORFEITED"]);
  });
});
