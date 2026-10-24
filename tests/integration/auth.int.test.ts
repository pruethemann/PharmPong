import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { sha256 } from "@/server/auth/tokens";
import { validateSessionToken, type Actor } from "@/server/auth/sessions";
import {
  changePassword,
  createPasswordResetLink,
  login,
  redeemPasswordReset,
  registerUser,
  updateProfile,
} from "@/server/services/auth";
import { setActive } from "@/server/services/users";
import { profileSchema, registerSchema } from "@/lib/validation/auth";
import { makeUser } from "./factories";

const PW = "richtig-langes-passwort";
let ipSeq = 0;
const meta = () => ({ ip: `10.0.0.${++ipSeq}`, userAgent: "vitest" });

function actorOf(u: {
  id: string;
  email: string;
  displayName: string;
  role: Actor["role"];
  mustChangePassword: boolean;
}): Actor {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

async function userWithPassword(email: string, role: Actor["role"] = "PLAYER") {
  return makeUser({ email, role, passwordHash: await hashPassword(PW) });
}

describe("registration", () => {
  it("always creates a PLAYER, even when role:ADMIN is smuggled in via the schema", async () => {
    const parsed = registerSchema.parse({
      email: "Neu@Test.Local",
      displayName: "Neu",
      password: PW,
      role: "ADMIN",
    });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed.email).toBe("neu@test.local");
    const r = await registerUser(parsed, meta());
    expect(r.user.role).toBe("PLAYER");
    expect((await db.user.findUniqueOrThrow({ where: { id: r.user.id } })).role).toBe("PLAYER");
  });

  it("always creates a PLAYER when the service is called directly with a role", async () => {
    const input = { email: "direct@test.local", displayName: "Direkt", password: PW, role: "ADMIN" };
    const r = await registerUser(input as unknown as Parameters<typeof registerUser>[0], meta());
    const row = await db.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(row.role).toBe("PLAYER");
    expect(row.mustChangePassword).toBe(false);
  });

  it("rejects a duplicate email case-insensitively with EMAIL_TAKEN", async () => {
    await registerUser(
      registerSchema.parse({ email: "dup@test.local", displayName: "Eins", password: PW }),
      meta(),
    );
    const again = registerSchema.parse({ email: "  DUP@Test.LOCAL ", displayName: "Zwei", password: PW });
    await expect(registerUser(again, meta())).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    expect(await db.user.count()).toBe(1);
  });

  it("enforces the event code when one is required", async () => {
    const input = registerSchema.parse({
      email: "code@test.local",
      displayName: "Code",
      password: PW,
      eventCode: "falsch",
    });
    await expect(registerUser(input, { ...meta(), requiredEventCode: "PIPETTE" })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { field: "eventCode" },
    });
    const ok = await registerUser(
      { ...input, eventCode: " PIPETTE " },
      { ...meta(), requiredEventCode: "PIPETTE" },
    );
    expect(ok.user.email).toBe("code@test.local");
  });
});

describe("login", () => {
  it("returns INVALID_CREDENTIALS for a wrong password and for an unknown email", async () => {
    await userWithPassword("known@test.local");
    await expect(
      login({ email: "known@test.local", password: "falsches-passwort" }, meta()),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(login({ email: "nobody@test.local", password: PW }, meta())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("locks the email after 5 failures, even for the correct password afterwards", async () => {
    await userWithPassword("brute@test.local");
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const err = await login({ email: "brute@test.local", password: `falsch-${i}-xxxxx` }, meta()).catch(
        (e) => e,
      );
      codes.push(err.code);
    }
    expect(codes.slice(0, 4)).toEqual(Array(4).fill("INVALID_CREDENTIALS"));
    expect(codes[4]).toBe("RATE_LIMITED");
    await expect(login({ email: "brute@test.local", password: PW }, meta())).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("clears the email counter after a successful login", async () => {
    await userWithPassword("clear@test.local");
    for (let i = 0; i < 3; i++) {
      await login({ email: "clear@test.local", password: "falsch-xxxxxxx" }, meta()).catch(() => undefined);
    }
    expect(
      await db.authThrottle.findUnique({ where: { key: "login:email:clear@test.local" } }),
    ).not.toBeNull();
    await login({ email: "clear@test.local", password: PW }, meta());
    expect(await db.authThrottle.findUnique({ where: { key: "login:email:clear@test.local" } })).toBeNull();
    // Four more failures are again only INVALID_CREDENTIALS (counter restarted).
    for (let i = 0; i < 4; i++) {
      await expect(
        login({ email: "clear@test.local", password: "falsch-xxxxxxx" }, meta()),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("rejects an inactive user with INVALID_CREDENTIALS", async () => {
    const u = await userWithPassword("inactive@test.local");
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    await expect(login({ email: "inactive@test.local", password: PW }, meta())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });
});

describe("sessions", () => {
  it("password change revokes other sessions but keeps the current one", async () => {
    const u = await userWithPassword("change@test.local");
    const a = await login({ email: "change@test.local", password: PW }, meta());
    const b = await login({ email: "change@test.local", password: PW }, meta());
    await changePassword(
      actorOf(u),
      { currentPassword: PW, newPassword: "ganz-neues-passwort" },
      sha256(a.token),
    );
    expect((await validateSessionToken(a.token))?.user.id).toBe(u.id);
    expect(await validateSessionToken(b.token)).toBeNull();
    await expect(login({ email: "change@test.local", password: PW }, meta())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(
      login({ email: "change@test.local", password: "ganz-neues-passwort" }, meta()),
    ).resolves.toBeTruthy();
  });

  it("password change with a wrong current password fails and changes nothing", async () => {
    const u = await userWithPassword("wrongcur@test.local");
    await expect(
      changePassword(
        actorOf(u),
        { currentPassword: "falsch-xxxxxx", newPassword: "ganz-neues-passwort" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(login({ email: "wrongcur@test.local", password: PW }, meta())).resolves.toBeTruthy();
  });

  it("a deactivated user's session token no longer validates", async () => {
    const admin = await userWithPassword("admin@test.local", "ADMIN");
    const u = await userWithPassword("deact@test.local");
    const s = await login({ email: "deact@test.local", password: PW }, meta());
    expect(await validateSessionToken(s.token)).not.toBeNull();
    await setActive(actorOf(admin), u.id, false);
    expect(await validateSessionToken(s.token)).toBeNull();
  });

  it("a token validates to null when isActive is flipped directly in the DB", async () => {
    const u = await userWithPassword("flip@test.local");
    const s = await login({ email: "flip@test.local", password: PW }, meta());
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect(await validateSessionToken(s.token)).toBeNull();
  });
});

describe("password reset links", () => {
  it("are single-use and revoke existing sessions", async () => {
    const admin = await userWithPassword("admin@test.local", "ADMIN");
    const u = await userWithPassword("reset@test.local");
    const s = await login({ email: "reset@test.local", password: PW }, meta());
    const { token } = await createPasswordResetLink(actorOf(admin), u.id);
    await redeemPasswordReset({ token, newPassword: "reset-passwort-neu" }, meta());
    expect(await validateSessionToken(s.token)).toBeNull();
    await expect(
      redeemPasswordReset({ token, newPassword: "noch-ein-passwort" }, meta()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      login({ email: "reset@test.local", password: "reset-passwort-neu" }, meta()),
    ).resolves.toBeTruthy();
  });

  it("expire", async () => {
    const admin = await userWithPassword("admin@test.local", "ADMIN");
    const u = await userWithPassword("expire@test.local");
    const { token } = await createPasswordResetLink(actorOf(admin), u.id);
    await db.passwordReset.updateMany({
      where: { tokenHash: sha256(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      redeemPasswordReset({ token, newPassword: "reset-passwort-neu" }, meta()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(login({ email: "expire@test.local", password: PW }, meta())).resolves.toBeTruthy();
  });

  it("a new admin link invalidates the previous one", async () => {
    const admin = await userWithPassword("admin@test.local", "ADMIN");
    const u = await userWithPassword("twice@test.local");
    const first = await createPasswordResetLink(actorOf(admin), u.id);
    const second = await createPasswordResetLink(actorOf(admin), u.id);
    await expect(
      redeemPasswordReset({ token: first.token, newPassword: "reset-passwort-neu" }, meta()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      redeemPasswordReset({ token: second.token, newPassword: "reset-passwort-neu" }, meta()),
    ).resolves.toBeUndefined();
  });

  it("can only be created by an admin", async () => {
    const ref = await userWithPassword("ref@test.local", "REFEREE");
    const u = await userWithPassword("victim@test.local");
    await expect(createPasswordResetLink(actorOf(ref), u.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("also clears mustChangePassword", async () => {
    const admin = await userWithPassword("admin@test.local", "ADMIN");
    const u = await userWithPassword("must@test.local");
    await db.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
    const { token } = await createPasswordResetLink(actorOf(admin), u.id);
    await redeemPasswordReset({ token, newPassword: "reset-passwort-neu" }, meta());
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).mustChangePassword).toBe(false);
  });
});

describe("profile", () => {
  it("updateProfile cannot change the role", async () => {
    const u = await userWithPassword("profile@test.local");
    const parsed = profileSchema.parse({ displayName: "  Neuer Name ", role: "ADMIN" });
    expect(parsed).toEqual({ displayName: "Neuer Name" });
    await updateProfile(actorOf(u), parsed);
    await updateProfile(actorOf(u), { displayName: "Direkt", role: "ADMIN" } as unknown as {
      displayName: string;
    });
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.role).toBe("PLAYER");
    expect(row.displayName).toBe("Direkt");
    const audit = await db.auditLog.findMany({ where: { action: "user.profile_update", entityId: u.id } });
    expect(audit).toHaveLength(2);
  });
});
