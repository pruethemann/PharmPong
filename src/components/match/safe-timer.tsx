"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { BigTimer } from "@/components/pp/big-timer";
import { cn } from "@/lib/utils";

const noop = () => () => {};

/** True after hydration (false during SSR and the hydration render). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const PLACEHOLDER_SIZE = { md: "h-12", lg: "h-[4.5rem] sm:h-24", xl: "h-40" } as const;

/**
 * BigTimer renders Date.now() on the first render, which never matches the
 * server HTML. Render it only after hydration; reserve its height before.
 */
export function SafeBigTimer(props: ComponentProps<typeof BigTimer>) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div
        aria-hidden="true"
        className={cn(PLACEHOLDER_SIZE[props.size ?? "lg"], "w-full", props.className)}
      />
    );
  }
  return <BigTimer {...props} />;
}
