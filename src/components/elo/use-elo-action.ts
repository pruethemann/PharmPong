"use client";

import { useCallback } from "react";
import type { ActionResult } from "@/lib/action-result";
import {
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  sessionKeyStore,
  type IdempotencyStep,
} from "@/lib/result-form";
import { useMatchAction, type RunOptions } from "@/components/referee/use-match-action";
import { useEloLive } from "./elo-live";

/**
 * Elo match actions with the referee semantics (one request at a time, toasts, snapshot refresh),
 * plus idempotency keys for result steps: the same key for every retry of the same
 * (match, step, revision), kept across a network loss so a resend is replayed, never doubled.
 */
export function useEloAction() {
  const { refresh } = useEloLive();
  const { pending, run } = useMatchAction({ refresh });

  const runKeyed = useCallback(
    async <T>(
      matchId: string,
      step: IdempotencyStep,
      revision: number,
      fn: (idempotencyKey: string) => Promise<ActionResult<T>>,
      opts?: RunOptions<T>,
    ) => {
      const store = sessionKeyStore();
      const key = getOrCreateIdempotencyKey(store, matchId, step, revision);
      const out = await run(step, () => fn(key), opts);
      if (out.kind === "ok" || out.kind === "error") clearIdempotencyKey(store, matchId, step, revision);
      return out;
    },
    [run],
  );

  return { pending, run, runKeyed };
}
