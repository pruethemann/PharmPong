import type { ErrorCode } from "@/server/domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
      details?: Record<string, unknown>;
    };
