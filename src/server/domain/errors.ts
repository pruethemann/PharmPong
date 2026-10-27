// Domain error codes. Mapped to UI messages in messages/*.json (namespace `errors`).
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
  // Elo Mode
  "WRONG_MODE",
  "PLAYER_BUSY",
  "SESSION_NOT_OPEN",
  "MODE_SWITCH_BLOCKED",
  "ROSTER_CHANGED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Translation key (namespace `errors.specific`) plus ICU values for a user-facing message.
 * `message` stays German so logs, tests and untranslated staff flows keep working.
 */
export type ErrorI18n = { key: string; values?: Record<string, string | number> };

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly i18n?: ErrorI18n;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>, i18n?: ErrorI18n) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.i18n = i18n;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function fail(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  i18n?: ErrorI18n,
): never {
  throw new DomainError(code, message, details, i18n);
}
