import "server-only";
import { z } from "zod";
import { getCurrentUser, touchSession } from "@/server/auth/current";
import type { SessionUser } from "@/server/auth/sessions";
import { DomainError, isDomainError, type ErrorCode } from "@/server/domain/errors";
import { toDomainError } from "@/server/services/pg-errors";
import { errorMessage } from "@/lib/i18n/de";
import type { Role } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";

type Access = "public" | Role;

const RANK: Record<Role, number> = { PLAYER: 0, REFEREE: 1, ADMIN: 2 };

/** Codes whose DomainError message is user-facing German text written by the domain/service layer. */
const DOMAIN_MESSAGE_CODES = new Set<ErrorCode>([
  "VALIDATION",
  "INVALID_RESULT",
  "INVALID_STATE",
  "INVALID_TRANSITION",
  "WRONG_TEAM_COUNT",
  "NOT_FOUND",
  "INVALID_CREDENTIALS",
  "CONFIRMATION_REQUIRED",
  "UNRESOLVED_TIE",
  "DOWNSTREAM_STARTED",
]);

/**
 * Wrap a Server Action: validate input with Zod, enforce role, map DomainErrors
 * to German messages. Success is only returned after the handler's transaction committed.
 */
export function defineAction<S extends z.ZodType, R>(config: {
  schema: S;
  access: Access;
  handler: (input: z.infer<S>, ctx: { user: SessionUser | null }) => Promise<R>;
}): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const user = await getCurrentUser();
      if (config.access !== "public") {
        if (!user) throw new DomainError("UNAUTHENTICATED");
        if (RANK[user.role] < RANK[config.access]) throw new DomainError("FORBIDDEN");
      }
      const parsed = config.schema.safeParse(raw);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".") || "_";
          fieldErrors[key] ??= issue.message;
        }
        return { ok: false, code: "VALIDATION", message: errorMessage.VALIDATION, fieldErrors };
      }
      const data = await config.handler(parsed.data, { user });
      if (user) await touchSession().catch(() => undefined);
      return { ok: true, data };
    } catch (e) {
      // Let Next.js redirect()/notFound() propagate.
      if (
        e &&
        typeof e === "object" &&
        "digest" in e &&
        typeof (e as { digest: unknown }).digest === "string"
      ) {
        const d = (e as { digest: string }).digest;
        if (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_HTTP_ERROR")) throw e;
      }
      const err = isDomainError(e) ? e : toDomainError(e);
      if (err.code === "INTERNAL") console.error("[action] internal error", e);
      // Domain errors may carry a specific German message (e.g. why a result is invalid).
      const specific = err.message && err.message !== err.code && DOMAIN_MESSAGE_CODES.has(err.code);
      return {
        ok: false,
        code: err.code as ErrorCode,
        message: specific ? err.message : (errorMessage[err.code] ?? err.message),
        details: err.details,
      };
    }
  };
}
