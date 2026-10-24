import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  assertTransition,
  canTransition,
  isPlayPhase,
  isRegistrationOpen,
  isRosterLocked,
} from "./tournament-state";
import type { TournamentStatus } from "./types";

const ALL: TournamentStatus[] = [
  "DRAFT",
  "REGISTRATION_OPEN",
  "REGISTRATION_LOCKED",
  "GROUP_STAGE",
  "KNOCKOUT_STAGE",
  "COMPLETED",
  "CANCELLED",
];

const NORMAL: Array<[TournamentStatus, TournamentStatus]> = [
  ["DRAFT", "REGISTRATION_OPEN"],
  ["REGISTRATION_OPEN", "REGISTRATION_LOCKED"],
  ["REGISTRATION_LOCKED", "REGISTRATION_OPEN"],
  ["REGISTRATION_LOCKED", "GROUP_STAGE"],
  ["GROUP_STAGE", "KNOCKOUT_STAGE"],
  ["KNOCKOUT_STAGE", "COMPLETED"],
  ["DRAFT", "CANCELLED"],
  ["REGISTRATION_OPEN", "CANCELLED"],
  ["REGISTRATION_LOCKED", "CANCELLED"],
  ["GROUP_STAGE", "CANCELLED"],
  ["KNOCKOUT_STAGE", "CANCELLED"],
];
const RECOVERY: Array<[TournamentStatus, TournamentStatus]> = [
  ["COMPLETED", "KNOCKOUT_STAGE"],
  ["KNOCKOUT_STAGE", "GROUP_STAGE"],
];
const key = (a: string, b: string) => `${a}>${b}`;

describe("canTransition", () => {
  it("allows exactly the normal edges without recovery", () => {
    const allowed = new Set(NORMAL.map(([a, b]) => key(a, b)));
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to), key(from, to)).toBe(allowed.has(key(from, to)));
      }
    }
  });
  it("adds the recovery edges only with recovery", () => {
    const allowed = new Set([...NORMAL, ...RECOVERY].map(([a, b]) => key(a, b)));
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to, { recovery: true }), key(from, to)).toBe(allowed.has(key(from, to)));
      }
    }
    expect(canTransition("COMPLETED", "KNOCKOUT_STAGE", { recovery: false })).toBe(false);
  });
  it("never leaves CANCELLED", () => {
    for (const to of ALL) expect(canTransition("CANCELLED", to, { recovery: true })).toBe(false);
  });
});

describe("assertTransition", () => {
  it("passes on allowed edges", () => {
    expect(() => assertTransition("DRAFT", "REGISTRATION_OPEN")).not.toThrow();
    expect(() => assertTransition("KNOCKOUT_STAGE", "GROUP_STAGE", { recovery: true })).not.toThrow();
  });
  it("throws INVALID_TRANSITION otherwise", () => {
    try {
      assertTransition("DRAFT", "GROUP_STAGE");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
      expect((e as DomainError).details).toMatchObject({ from: "DRAFT", to: "GROUP_STAGE" });
    }
  });
});

describe("status predicates", () => {
  it("isRegistrationOpen", () => {
    expect(ALL.filter(isRegistrationOpen)).toEqual(["REGISTRATION_OPEN"]);
  });
  it("isRosterLocked from REGISTRATION_LOCKED onward", () => {
    expect(ALL.filter(isRosterLocked)).toEqual([
      "REGISTRATION_LOCKED",
      "GROUP_STAGE",
      "KNOCKOUT_STAGE",
      "COMPLETED",
      "CANCELLED",
    ]);
  });
  it("isPlayPhase", () => {
    expect(ALL.filter(isPlayPhase)).toEqual(["GROUP_STAGE", "KNOCKOUT_STAGE"]);
  });
});
