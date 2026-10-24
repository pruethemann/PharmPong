import { describe, expect, it } from "vitest";
import {
  advanceRotation,
  DISPLAY_ROTATION_MS,
  displayPanels,
  initRotation,
  nextPanel,
  rotationProgress,
  type PanelInput,
} from "./display-rotation";

const base: PanelInput = {
  status: "GROUP_STAGE",
  groupCount: 4,
  knockoutMatchCount: 7,
  upNextCount: 4,
  teamCount: 12,
};

describe("displayPanels", () => {
  it("orders panels by relevance per phase", () => {
    expect(displayPanels(base)).toEqual(["groups", "upNext", "bracket"]);
    expect(displayPanels({ ...base, status: "KNOCKOUT_STAGE" })).toEqual(["bracket", "upNext", "groups"]);
    expect(displayPanels({ ...base, status: "COMPLETED", upNextCount: 0 })).toEqual(["bracket", "groups"]);
  });

  it("skips empty panels", () => {
    expect(displayPanels({ ...base, upNextCount: 0 })).toEqual(["groups", "bracket"]);
    expect(displayPanels({ ...base, status: "KNOCKOUT_STAGE", upNextCount: 0, groupCount: 0 })).toEqual([
      "bracket",
    ]);
  });

  it("shows registered teams before the draw and never returns an empty list", () => {
    const pre = {
      status: "REGISTRATION_OPEN",
      groupCount: 0,
      knockoutMatchCount: 0,
      upNextCount: 0,
    } as const;
    expect(displayPanels({ ...pre, teamCount: 5 })).toEqual(["teams"]);
    expect(displayPanels({ ...pre, teamCount: 0 })).toEqual(["teams"]);
    expect(
      displayPanels({ ...base, status: "GROUP_STAGE", groupCount: 0, knockoutMatchCount: 0, upNextCount: 0 }),
    ).toEqual(["teams"]);
  });
});

describe("nextPanel", () => {
  it("wraps around and recovers from a vanished panel", () => {
    expect(nextPanel("groups", ["groups", "upNext"])).toBe("upNext");
    expect(nextPanel("upNext", ["groups", "upNext"])).toBe("groups");
    expect(nextPanel("bracket", ["groups", "upNext"])).toBe("groups");
    expect(nextPanel(null, ["upNext"])).toBe("upNext");
    expect(nextPanel("groups", [])).toBe("teams");
  });
});

describe("advanceRotation", () => {
  const panels = ["groups", "upNext", "bracket"] as const;

  it("advances only after the interval", () => {
    const s0 = initRotation(panels, 0);
    expect(s0).toEqual({ panel: "groups", since: 0 });
    expect(advanceRotation(s0, DISPLAY_ROTATION_MS - 1, panels, { paused: false })).toBe(s0);
    const s1 = advanceRotation(s0, DISPLAY_ROTATION_MS, panels, { paused: false });
    expect(s1).toEqual({ panel: "upNext", since: DISPLAY_ROTATION_MS });
    const s2 = advanceRotation(s1, 2 * DISPLAY_ROTATION_MS, panels, { paused: false });
    const s3 = advanceRotation(s2, 3 * DISPLAY_ROTATION_MS, panels, { paused: false });
    expect(s3.panel).toBe("groups");
  });

  it("honours a custom interval", () => {
    const s0 = initRotation(panels, 0);
    expect(advanceRotation(s0, 5000, panels, { paused: false, intervalMs: 5000 }).panel).toBe("upNext");
  });

  it("freezes while paused and restarts the time slice", () => {
    const s0 = initRotation(panels, 0);
    const paused = advanceRotation(s0, 60_000, panels, { paused: true });
    expect(paused).toEqual({ panel: "groups", since: 60_000 });
    expect(advanceRotation(paused, 60_000, panels, { paused: true })).toBe(paused);
    // Right after resuming, the panel stays for a full slice.
    expect(advanceRotation(paused, 61_000, panels, { paused: false })).toBe(paused);
    expect(advanceRotation(paused, 60_000 + DISPLAY_ROTATION_MS, panels, { paused: false }).panel).toBe(
      "upNext",
    );
  });

  it("does not rotate a single panel", () => {
    const s0 = initRotation(["bracket"], 0);
    expect(advanceRotation(s0, 10 * DISPLAY_ROTATION_MS, ["bracket"], { paused: false })).toBe(s0);
  });

  it("jumps to the first panel when the current one disappears, even while paused", () => {
    const s0 = { panel: "teams", since: 0 } as const;
    expect(advanceRotation(s0, 100, panels, { paused: true })).toEqual({ panel: "groups", since: 100 });
  });
});

describe("rotationProgress", () => {
  it("is clamped to 0..1", () => {
    const s = { panel: "groups", since: 1000 } as const;
    expect(rotationProgress(s, 500)).toBe(0);
    expect(rotationProgress(s, 1000 + DISPLAY_ROTATION_MS / 2)).toBe(0.5);
    expect(rotationProgress(s, 1e9)).toBe(1);
  });
});
