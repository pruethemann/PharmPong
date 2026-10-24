import { describe, expect, it } from "vitest";
import { hashPassword, verifyDummy, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes with argon2id and verifies the round trip", async () => {
    const h = await hashPassword("korrekt-pferd-batterie");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "korrekt-pferd-batterie")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const h = await hashPassword("korrekt-pferd-batterie");
    expect(await verifyPassword(h, "falsch-pferd-batterie")).toBe(false);
  });

  it("salts: same password gives different hashes", async () => {
    expect(await hashPassword("gleiches-passwort")).not.toBe(await hashPassword("gleiches-passwort"));
  });

  it("returns false instead of throwing for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });

  it("verifyDummy resolves without throwing", async () => {
    await expect(verifyDummy("irgendwas")).resolves.toBeUndefined();
  });
});
