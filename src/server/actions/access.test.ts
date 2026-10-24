import { describe, expect, it } from "vitest";
import { accessError, PASSWORD_CHANGE_REQUIRED_MESSAGE } from "./access";

const u = (role: "PLAYER" | "REFEREE" | "ADMIN", mustChangePassword = false) => ({
  role,
  mustChangePassword,
});

describe("accessError", () => {
  it("allows public access without a user", () => {
    expect(accessError(null, "public")).toBeNull();
  });

  it("requires a session and the minimum role", () => {
    expect(accessError(null, "PLAYER")?.code).toBe("UNAUTHENTICATED");
    expect(accessError(u("PLAYER"), "REFEREE")?.code).toBe("FORBIDDEN");
    expect(accessError(u("REFEREE"), "REFEREE")).toBeNull();
    expect(accessError(u("ADMIN"), "REFEREE")).toBeNull();
  });

  it("blocks every non-public action until the initial password was changed", () => {
    const err = accessError(u("ADMIN", true), "ADMIN");
    expect(err?.code).toBe("FORBIDDEN");
    expect(err?.message).toBe(PASSWORD_CHANGE_REQUIRED_MESSAGE);
    expect(err?.details).toEqual({ reason: "PASSWORD_CHANGE_REQUIRED" });
    expect(accessError(u("PLAYER", true), "PLAYER")?.code).toBe("FORBIDDEN");
  });

  it("allows the password change itself while a change is pending", () => {
    expect(accessError(u("ADMIN", true), "PLAYER", { allowPendingPasswordChange: true })).toBeNull();
    expect(accessError(u("PLAYER", true), "public")).toBeNull();
  });
});
