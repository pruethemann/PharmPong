"use client";

import { useSyncExternalStore } from "react";
import { BigTimer } from "@/components/pp/big-timer";
import type { LiveTimer } from "@/lib/live-types";

const noop = () => () => {};

/** True only after hydration (avoids SSR/client mismatches for clock-based output). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * BigTimer rendered only on the client: the shared BigTimer reads Date.now() during
 * render, which differs between server and client and breaks hydration.
 */
export function ClientTimer({ timer, clockOffsetMs }: { timer: LiveTimer; clockOffsetMs: number }) {
  const mounted = useMounted();
  if (!mounted) {
    return (
      <span className="font-display tabular text-muted-foreground text-5xl leading-none" aria-hidden="true">
        --:--
      </span>
    );
  }
  return <BigTimer timer={timer} clockOffsetMs={clockOffsetMs} size="md" />;
}
