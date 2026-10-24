// Pure access check shared by defineAction and the route handlers.
import { DomainError } from "@/server/domain/errors";
import type { Role } from "@/generated/prisma/enums";

export type Access = "public" | Role;

const RANK: Record<Role, number> = { PLAYER: 0, REFEREE: 1, ADMIN: 2 };

export const PASSWORD_CHANGE_REQUIRED_MESSAGE = "Bitte ändere zuerst dein Passwort.";

type AccessUser = { role: Role; mustChangePassword: boolean };

/**
 * Null when `user` may use an endpoint with `access`, else the DomainError to
 * throw. A user who still has to change the initial password may only use
 * endpoints that explicitly allow it (the password change itself).
 */
export function accessError(
  user: AccessUser | null,
  access: Access,
  opts: { allowPendingPasswordChange?: boolean } = {},
): DomainError | null {
  if (access === "public") return null;
  if (!user) return new DomainError("UNAUTHENTICATED");
  if (user.mustChangePassword && !opts.allowPendingPasswordChange) {
    return new DomainError("FORBIDDEN", PASSWORD_CHANGE_REQUIRED_MESSAGE, {
      reason: "PASSWORD_CHANGE_REQUIRED",
    });
  }
  if (RANK[user.role] < RANK[access]) return new DomainError("FORBIDDEN");
  return null;
}
