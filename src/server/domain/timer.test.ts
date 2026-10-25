import { describe, expect, it } from "vitest";
import { computeTimer, formatClock, formatElapsed } from "./timer";

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

describe("formatElapsed (Elo stopwatch)", () => {
  it("counts up in mm:ss like the spec example", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(272_000)).toBe("04:32");
    expect(formatElapsed(828_000)).toBe("13:48");
    expect(formatElapsed(1_636_000)).toBe("27:16");
  });
  it("rounds down instead of up", () => {
    expect(formatElapsed(59_999)).toBe("00:59");
    expect(formatElapsed(61_001)).toBe("01:01");
  });
  it("switches to h:mm:ss after an hour and never goes negative", () => {
    expect(formatElapsed(3_599_999)).toBe("59:59");
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5_000)).toBe("00:00");
  });
  it("uses elapsedMs from computeTimer, which already excludes paused time", () => {
    const t = computeTimer({ ...base, pausedAt: 400_000, pausedDurationMs: 100_000 }, 900_000);
    expect(formatElapsed(t.elapsedMs)).toBe("05:00");
  });
});
