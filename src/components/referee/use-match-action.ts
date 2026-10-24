"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

export type RunOptions<T> = {
  /** Toast shown only after the server returned ok. */
  successToast?: string | ((data: T) => string);
  /**
   * When the request never got a definitive answer (network loss). The server may
   * still have committed it: the caller must not assume either outcome.
   */
  onNetworkError?: () => void;
};

export type RunOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; result: Extract<ActionResult<T>, { ok: false }> }
  | { kind: "network" }
  | { kind: "skipped" };

/**
 * Runs a referee Server Action:
 * - only one request at a time (`pending` holds the running action id)
 * - success is reported only after the action returned ok
 * - STALE_VERSION (and every other error) toasts the server message and refreshes the snapshot
 * - a thrown promise (offline, server unreachable) is a network error: the server may or may
 *   not have committed it, so nothing is assumed, the snapshot is reloaded and the caller
 *   keeps its idempotency key so a resend is replayed instead of executed twice
 */
export function useMatchAction({ refresh }: { refresh: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async <T>(
      id: string,
      fn: () => Promise<ActionResult<T>>,
      opts: RunOptions<T> = {},
    ): Promise<RunOutcome<T>> => {
      if (busy.current) return { kind: "skipped" };
      busy.current = true;
      setPending(id);
      try {
        let res: ActionResult<T>;
        try {
          res = await fn();
        } catch {
          toast.error("Verbindung unterbrochen. Unklar, ob gespeichert wurde.", {
            description: "Der aktuelle Stand wird neu geladen. Bitte prüfen, bevor du es nochmals versuchst.",
          });
          opts.onNetworkError?.();
          refresh();
          return { kind: "network" };
        }
        refresh();
        if (!res.ok) {
          toast.error(res.message);
          return { kind: "error", result: res };
        }
        if (opts.successToast) {
          toast.success(
            typeof opts.successToast === "function" ? opts.successToast(res.data) : opts.successToast,
          );
        }
        return { kind: "ok", data: res.data };
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [refresh],
  );

  return { pending, run };
}

export type RunFn = ReturnType<typeof useMatchAction>["run"];
