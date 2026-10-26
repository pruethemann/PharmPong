"use client";

import { useEffect, useState } from "react";
import { BellRing, Pause } from "lucide-react";
import { computeTimer, formatElapsed } from "@/server/domain/timer";
import type { EloLiveTimer } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";

/** Played time of an Elo match (pauses excluded), from server timestamps. */
export function elapsedOf(timer: EloLiveTimer, nowMs: number): number {
  return computeTimer({ ...timer, durationSec: 0 }, nowMs).elapsedMs;
}

/**
 * Count-up stopwatch of an Elo match (no time limit). Server-authoritative like BigTimer:
 * `clockOffsetMs` = serverNow − clientNow from the live snapshot, so every phone shows the same
 * time. The optional reminder is a soft hint only; nothing happens when it appears.
 */
export function Stopwatch({
  timer,
  clockOffsetMs = 0,
  reminderMinutes = null,
  size = "lg",
  className,
}: {
  timer: EloLiveTimer;
  clockOffsetMs?: number;
  reminderMinutes?: number | null;
  /** "display": em-based for the projector (scales with the display root font). */
  size?: "sm" | "md" | "lg" | "xl" | "display";
  className?: string;
}) {
  // null until mounted: the server render must not depend on the clock (hydration).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const reference = now ?? timer.endedAt ?? timer.pausedAt ?? timer.startedAt ?? 0;
  const elapsed = elapsedOf(timer, reference + (now == null ? 0 : clockOffsetMs));
  const paused = timer.endedAt == null && timer.pausedAt != null;
  const running = timer.startedAt != null && timer.endedAt == null && !paused;
  const remind = running && reminderMinutes != null && elapsed >= reminderMinutes * 60_000;
  const text = formatElapsed(elapsed);

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <span
        role="timer"
        aria-live="off"
        aria-label={`Spielzeit ${text}${paused ? ", pausiert" : ""}`}
        className={cn(
          "font-display tabular leading-none",
          size === "sm" && "text-3xl",
          size === "md" && "text-5xl",
          size === "lg" && "text-7xl sm:text-8xl",
          size === "xl" && "text-[10rem]",
          size === "display" && "text-[7em]",
          paused ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {text}
      </span>
      {paused ? (
        <span
          className={cn(
            "bg-warning font-display text-warning-foreground inline-flex items-center gap-2 rounded-full px-3 py-1 text-base",
            size === "display" && "text-[1.6em]",
          )}
        >
          <Pause className="size-[1em]" aria-hidden="true" /> Pausiert
        </span>
      ) : remind ? (
        <span
          role="status"
          className={cn(
            "border-warning/60 text-warning inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
            size === "display" && "text-[1.4em]",
          )}
        >
          <BellRing className="size-[1em]" aria-hidden="true" /> Über {reminderMinutes} Min. gespielt: Zeit
          fürs Finale
        </span>
      ) : null}
    </div>
  );
}
