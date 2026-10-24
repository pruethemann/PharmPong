"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const noop = () => () => {};

/** True after hydration. Server render and the hydration pass see `false`. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * Renders `children` only on the client (e.g. clocks based on Date.now(), which would
 * otherwise cause hydration mismatches), with an optional same-size fallback.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <>{useHydrated() ? children : fallback}</>;
}
