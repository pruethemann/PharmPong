"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void): () => void {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}

/** Client time, ticking every second; null during SSR/hydration (no mismatch). */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => null,
  );
}
