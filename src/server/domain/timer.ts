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

/** Count-up stopwatch (Elo Mode): mm:ss, from one hour h:mm:ss. Rounds down; never negative. */
export function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** mm:ss; negative values render as "+mm:ss" (overtime). */
export function formatClock(remainingMs: number): string {
  const over = remainingMs < 0;
  const totalSec = over ? Math.floor(-remainingMs / 1000) : Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${over ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
