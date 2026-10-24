// Service-level authorization. Every privileged service calls one of these,
// in addition to the guard in the Server Action. Defense in depth.
import { fail } from "@/server/domain/errors";
import type { Role } from "@/generated/prisma/enums";
import type { Actor } from "./sessions";

const RANK: Record<Role, number> = { PLAYER: 0, REFEREE: 1, ADMIN: 2 };

export function assertRole(actor: Actor | null | undefined, min: Role): asserts actor is Actor {
  if (!actor) fail("UNAUTHENTICATED");
  if (RANK[actor.role] < RANK[min]) fail("FORBIDDEN");
}

export const isAdmin = (a: Actor | null | undefined) => !!a && a.role === "ADMIN";
export const isReferee = (a: Actor | null | undefined) => !!a && RANK[a.role] >= RANK.REFEREE;
