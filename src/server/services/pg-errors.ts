import { DomainError, isDomainError, type ErrorCode } from "@/server/domain/errors";

// Map raw Postgres / Prisma errors to DomainErrors. Constraint names come from
// prisma/migrations/*_constraints/migration.sql.
const CONSTRAINT_CODES: Record<string, ErrorCode> = {
  match_one_active_per_table: "TABLE_BUSY",
  ActiveTeamMatch_pkey: "TEAM_BUSY",
  team_member_active_user: "ALREADY_IN_TEAM",
  team_member_active_slot: "TEAM_FULL",
  Team_tournamentId_nameNormalized_key: "NAME_TAKEN",
  User_email_key: "EMAIL_TAKEN",
  group_tiebreak_active: "STALE_VERSION",
};

function collectStrings(e: unknown, depth = 0): string {
  if (depth > 4 || e == null) return "";
  if (typeof e === "string") return e;
  if (typeof e !== "object") return "";
  const o = e as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["message", "code", "constraint", "detail", "originalMessage", "originalCode"]) {
    if (typeof o[k] === "string") parts.push(o[k] as string);
  }
  for (const k of ["meta", "cause", "driverAdapterError", "error"]) {
    if (o[k]) parts.push(collectStrings(o[k], depth + 1));
  }
  if (o.meta && typeof o.meta === "object") parts.push(JSON.stringify(o.meta));
  return parts.join(" | ");
}

export function pgErrorCode(e: unknown): string | undefined {
  const s = collectStrings(e);
  const m = s.match(/\b(23505|23514|23503|40001|40P01|P2002|P2034|P2025)\b/);
  if (m) return m[1];
  if (/unique constraint/i.test(s)) return "23505";
  if (/check constraint/i.test(s)) return "23514";
  if (/deadlock/i.test(s)) return "40P01";
  if (/could not serialize/i.test(s)) return "40001";
  return undefined;
}

export function isRetryable(e: unknown): boolean {
  const c = pgErrorCode(e);
  return c === "40001" || c === "40P01" || c === "P2034";
}

export function toDomainError(e: unknown): DomainError {
  if (isDomainError(e)) return e;
  const s = collectStrings(e);
  for (const [constraint, code] of Object.entries(CONSTRAINT_CODES)) {
    if (s.includes(constraint)) return new DomainError(code);
  }
  const c = pgErrorCode(e);
  if (c === "23505" || c === "P2002") {
    if (/email/i.test(s)) return new DomainError("EMAIL_TAKEN");
    if (/nameNormalized/i.test(s)) return new DomainError("NAME_TAKEN");
    if (/teamId/.test(s) && /ActiveTeamMatch/.test(s)) return new DomainError("TEAM_BUSY");
    return new DomainError("STALE_VERSION", "unique violation");
  }
  if (c === "23514") return new DomainError("INVALID_STATE", "check constraint violated");
  if (c === "P2025") return new DomainError("NOT_FOUND");
  return new DomainError("INTERNAL", e instanceof Error ? e.message : String(e));
}
