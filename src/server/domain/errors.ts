// Domain error codes. Mapped to German UI messages in src/lib/i18n/de.ts.
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION",
  "NOT_FOUND",
  "STALE_VERSION",
  "INVALID_STATE",
  "INVALID_TRANSITION",
  "TOURNAMENT_PAUSED",
  "TEAM_BUSY",
  "TABLE_BUSY",
  "TABLE_DISABLED",
  "TEAM_FULL",
  "ALREADY_IN_TEAM",
  "NOT_IN_TEAM",
  "ROSTER_LOCKED",
  "INVALID_INVITE",
  "NAME_TAKEN",
  "EMAIL_TAKEN",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "WRONG_TEAM_COUNT",
  "GROUPS_INCOMPLETE",
  "UNRESOLVED_TIE",
  "INVALID_RESULT",
  "DOWNSTREAM_STARTED",
  "IDEMPOTENCY_MISMATCH",
  "CONFIRMATION_REQUIRED",
  "UPLOAD_INVALID",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function fail(code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  throw new DomainError(code, message, details);
}
