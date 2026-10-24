import { describe, expect, it } from "vitest";
import { computeTimer, formatClock } from "./timer";

const base = { startedAt: 0, pausedAt: null, endedAt: null, pausedDurationMs: 0, durationSec: 900 };

describe("computeTimer", () => {
  it("is idle before start", () => {
    const t = computeTimer({ ...base, startedAt: null }, 5000);
    expect(t).toMatchObject({ running: false, remainingMs: 900_000, isOverTime: false });
  });
  it("counts down while running", () => {
    expect(computeTimer(base, 60_000)).toMatchObject({
      running: true,
      elapsedMs: 60_000,
      remainingMs: 840_000,
    });
  });
  it("freezes while paused and subtracts paused time", () => {
    const t = computeTimer({ ...base, pausedAt: 100_000, pausedDurationMs: 20_000 }, 500_000);
    expect(t).toMatchObject({ paused: true, running: false, elapsedMs: 80_000 });
  });
  it("flags overtime at the limit", () => {
    expect(computeTimer(base, 900_000).isOverTime).toBe(true);
    expect(computeTimer(base, 899_999).isOverTime).toBe(false);
  });
  it("stops at endedAt", () => {
    const t = computeTimer({ ...base, endedAt: 300_000 }, 10_000_000);
    expect(t).toMatchObject({ running: false, paused: false, elapsedMs: 300_000 });
  });
  it("never reports negative elapsed time (clock skew)", () => {
    expect(computeTimer({ ...base, startedAt: 10_000 }, 0).elapsedMs).toBe(0);
  });
});

describe("formatClock", () => {
  it("formats remaining and overtime", () => {
    expect(formatClock(900_000)).toBe("15:00");
    expect(formatClock(61_001)).toBe("01:02");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-75_000)).toBe("+01:15");
  });
});
