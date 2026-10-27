import { describe, expect, it } from "vitest";
import { passwordSchema } from "@/lib/validation/auth";
import { inviteCode, normalizeInviteCode, oneTimePassword, randomToken, sha256 } from "./tokens";

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

describe("oneTimePassword", () => {
  it("is four groups of five unambiguous characters that pass the password rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = oneTimePassword();
      expect(pw).toMatch(/^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$/);
      expect(passwordSchema.safeParse(pw).success).toBe(true);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });
});
