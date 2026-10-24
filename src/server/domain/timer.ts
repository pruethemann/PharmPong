// Match clock. All inputs are server timestamps (ms since epoch).

export type TimerInput = {
  startedAt: number | null;
  pausedAt: number | null;
  endedAt: number | null;
  pausedDurationMs: number;
  durationSec: number;
};

export type TimerState = {
  running: boolean;
  paused: boolean;
  elapsedMs: number;
  remainingMs: number; // negative when over time
  isOverTime: boolean;
};

export function computeTimer(t: TimerInput, nowMs: number): TimerState {
  if (t.startedAt == null) {
    return {
      running: false,
      paused: false,
      elapsedMs: 0,
      remainingMs: t.durationSec * 1000,
      isOverTime: false,
    };
  }
  const reference = t.endedAt ?? t.pausedAt ?? nowMs;
  const elapsedMs = Math.max(0, reference - t.startedAt - t.pausedDurationMs);
  const remainingMs = t.durationSec * 1000 - elapsedMs;
  return {
    running: t.endedAt == null && t.pausedAt == null,
    paused: t.endedAt == null && t.pausedAt != null,
    elapsedMs,
    remainingMs,
    isOverTime: remainingMs <= 0,
  };
}

/** mm:ss; negative values render as "+mm:ss" (overtime). */
export function formatClock(remainingMs: number): string {
  const over = remainingMs < 0;
  const totalSec = over ? Math.floor(-remainingMs / 1000) : Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${over ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
