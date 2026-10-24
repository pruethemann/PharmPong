import { describe, expect, it } from "vitest";
import {
  applyLiveResponse,
  buildLiveUrl,
  connectionState,
  nextPollDelay,
  offsetSample,
  parseSince,
  smoothOffset,
} from "./live-client";

describe("nextPollDelay", () => {
  it("uses the normal interval without failures", () => {
    expect(nextPollDelay(0)).toBe(2500);
    expect(nextPollDelay(0, 4000)).toBe(4000);
  });

  it("backs off exponentially up to 15 s", () => {
    expect([1, 2, 3, 4, 5, 50].map((f) => nextPollDelay(f))).toEqual([
      2500, 5000, 10000, 15000, 15000, 15000,
    ]);
  });
});

describe("connectionState", () => {
  it("is online without failures", () => {
    expect(connectionState(0, true)).toBe("online");
  });
  it("is reconnecting after one or two failures", () => {
    expect(connectionState(1, true)).toBe("reconnecting");
    expect(connectionState(2, true)).toBe("reconnecting");
  });
  it("is offline after three failures or when the browser is offline", () => {
    expect(connectionState(3, true)).toBe("offline");
    expect(connectionState(0, false)).toBe("offline");
  });
});

describe("clock offset", () => {
  it("takes the midpoint of the round trip", () => {
    expect(offsetSample(10_500, 1_000, 2_000)).toBe(9_000);
  });

  it("starts with the first sample and smooths later ones", () => {
    expect(smoothOffset(null, 400)).toBe(400);
    expect(smoothOffset(400, 800)).toBe(500);
  });

  it("resets on large jumps", () => {
    expect(smoothOffset(0, 60_000)).toBe(60_000);
  });
});

describe("buildLiveUrl / parseSince", () => {
  it("appends since", () => {
    expect(buildLiveUrl("/api/live", null)).toBe("/api/live");
    expect(buildLiveUrl("/api/live", 7)).toBe("/api/live?since=7");
    expect(buildLiveUrl("/api/live?x=1", 0)).toBe("/api/live?x=1&since=0");
  });

  it("parses only non-negative integers", () => {
    expect(parseSince("12")).toBe(12);
    expect(parseSince("0")).toBe(0);
    expect(parseSince(null)).toBeNull();
    expect(parseSince("-1")).toBeNull();
    expect(parseSince("1.5")).toBeNull();
    expect(parseSince("abc")).toBeNull();
  });
});

describe("applyLiveResponse", () => {
  const current = { revision: 3, serverNow: 1, value: "a" };

  it("keeps data when unchanged", () => {
    expect(applyLiveResponse(current, { unchanged: true, revision: 3, serverNow: 2 })).toBe(current);
  });

  it("replaces data and drops the flag otherwise", () => {
    const next = applyLiveResponse(current, { unchanged: false, revision: 4, serverNow: 2, value: "b" });
    expect(next).toEqual({ revision: 4, serverNow: 2, value: "b" });
    expect(next).not.toHaveProperty("unchanged");
  });
});
