"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Pause } from "lucide-react";
import { computeTimer, formatClock, type TimerInput } from "@/server/domain/timer";
import { cn } from "@/lib/utils";

/**
 * Server-authoritative countdown. `clockOffsetMs` = serverNow - clientNow,
 * taken from the latest live snapshot, so all devices show the same time.
 */
export function BigTimer({
  timer,
  clockOffsetMs = 0,
  size = "lg",
  className,
}: {
  timer: TimerInput;
  clockOffsetMs?: number;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  // null until mounted: the server render must not depend on the clock (hydration).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const reference = now ?? timer.endedAt ?? timer.pausedAt ?? timer.startedAt ?? 0;
  const state = computeTimer(timer, reference + (now == null ? 0 : clockOffsetMs));
  const warn = !state.isOverTime && state.remainingMs <= 60_000 && timer.startedAt != null;

  return (
    <div
      className={cn("flex flex-col items-center gap-1", className)}
      role="timer"
      aria-live="off"
      aria-label={state.isOverTime ? "Zeit abgelaufen" : `Restzeit ${formatClock(state.remainingMs)}`}
    >
      <span
        className={cn(
          "font-display tabular leading-none",
          size === "md" && "text-5xl",
          size === "lg" && "text-7xl sm:text-8xl",
          size === "xl" && "text-[10rem]",
          state.isOverTime ? "text-destructive" : warn ? "text-warning" : "text-foreground",
        )}
      >
        {formatClock(state.remainingMs)}
      </span>
      {state.isOverTime && timer.endedAt == null ? (
        <span
          className="bg-destructive font-display text-destructive-foreground inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-lg"
          role="status"
        >
          <AlarmClock className="size-5" aria-hidden="true" /> Zeit abgelaufen: Zugpaar fertig spielen
        </span>
      ) : state.paused ? (
        <span className="bg-warning font-display text-warning-foreground inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-lg">
          <Pause className="size-5" aria-hidden="true" /> Pausiert
        </span>
      ) : null}
    </div>
  );
}
