import { describe, expect, it } from "vitest";
import { inviteCode, normalizeInviteCode, randomToken, sha256 } from "./tokens";

describe("inviteCode", () => {
  it("has the default length 8 and uses only the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = inviteCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("respects a custom length", () => {
    expect(inviteCode(12)).toHaveLength(12);
  });

  it("is a fixed point of normalizeInviteCode", () => {
    for (let i = 0; i < 50; i++) {
      const c = inviteCode();
      expect(normalizeInviteCode(c)).toBe(c);
    }
  });
});

describe("normalizeInviteCode", () => {
  it("uppercases and strips separators and whitespace", () => {
    expect(normalizeInviteCode(" ab-cd 12_34 ")).toBe("ABCD1234");
  });

  it("maps look-alike letters to digits", () => {
    expect(normalizeInviteCode("iLoO")).toBe("1100");
  });
});

describe("randomToken / sha256", () => {
  it("produces url-safe unique tokens and stable hex hashes", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256("x")).toBe(sha256("x"));
    expect(sha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
