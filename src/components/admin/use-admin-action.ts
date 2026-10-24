"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

export type AdminFailure = Extract<ActionResult<unknown>, { ok: false }>;

export type RunOptions<T> = {
  /** Toast after the server confirmed success. */
  success?: string | ((data: T) => string);
  onOk?: (data: T) => void;
  /** Return true when the failure was handled (no generic toast). */
  onError?: (failure: AdminFailure) => boolean | void;
};

/**
 * Runs admin Server Actions: one pending id at a time, success only after `ok`,
 * STALE_VERSION → warning toast + refresh, network errors never look like success.
 */
export function useAdminAction(refresh: () => void) {
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async <T>(
      id: string,
      fn: () => Promise<ActionResult<T>>,
      opts: RunOptions<T> = {},
    ): Promise<ActionResult<T> | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(id);
      try {
        const res = await fn();
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onOk?.(res.data);
          refresh();
          return res;
        }
        if (res.code === "STALE_VERSION") {
          toast.warning(res.message);
          refresh();
          opts.onError?.(res);
          return res;
        }
        const handled = opts.onError?.(res);
        if (!handled) toast.error(res.message);
        if (res.code === "INVALID_STATE" || res.code === "TABLE_BUSY" || res.code === "TEAM_BUSY") refresh();
        return res;
      } catch {
        toast.error("Keine Verbindung zum Server. Es wurde nichts gespeichert. Bitte erneut versuchen.");
        return null;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [refresh],
  );

  return { run, pending, isPending: (id?: string) => (id ? pending === id : pending !== null) };
}
