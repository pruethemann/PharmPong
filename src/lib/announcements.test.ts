import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_QUEUE_MAX,
  describeEvent,
  dismissAnnouncement,
  enqueueAnnouncements,
  initAnnouncements,
  receiveEvents,
  toAnnouncements,
  unseenEvents,
  type Announcement,
  type AnnouncementContext,
} from "./announcements";
import type { LiveEvent } from "./live-types";

const ctx: AnnouncementContext = {
  teams: [
    { id: "t1", name: "Die Pipettierer" },
    { id: "t2", name: "Placebo-Effekt" },
    { id: "t3", name: "Ibuprofans" },
  ],
  matches: [
    { id: "m1", label: "Gruppe A · Runde 1", tableNumber: 2, homeTeamId: "t1", awayTeamId: "t2" },
    { id: "sf1", label: "Halbfinal 1", tableNumber: null, homeTeamId: "t1", awayTeamId: null },
    { id: "f", label: "Final", tableNumber: null, homeTeamId: null, awayTeamId: null },
  ],
};

let n = 0;
function ev(type: LiveEvent["type"], matchId: string | null, teamId: string | null = null): LiveEvent {
  n += 1;
  return { id: `e${n}`, type, matchId, teamId, at: 1000 + n };
}

describe("describeEvent", () => {
  it("announces a new match with its table and pairing", () => {
    const a = describeEvent(ev("MATCH_STARTED", "m1"), ctx);
    expect(a).toMatchObject({
      kind: "NEW_MATCH",
      title: "Neues Spiel an Tisch 2",
      subtitle: "Die Pipettierer vs Placebo-Effekt",
      tableNumber: 2,
    });
  });

  it("falls back when the table or teams are unknown", () => {
    const a = describeEvent(ev("MATCH_ASSIGNED", "f"), ctx);
    expect(a).toMatchObject({ title: "Neues Spiel", subtitle: "Final", tableNumber: null });
    expect(describeEvent(ev("MATCH_ASSIGNED", "gone"), ctx)).toMatchObject({ subtitle: null });
  });

  it("announces semifinal and final advancement with the team name", () => {
    expect(describeEvent(ev("ADVANCED_SEMIFINAL", "sf1", "t3"), ctx)).toMatchObject({
      kind: "SEMIFINAL",
      title: "Ibuprofans steht im Halbfinal!",
      subtitle: "Halbfinal 1",
    });
    expect(describeEvent(ev("ADVANCED_FINAL", "f", "t1"), ctx)).toMatchObject({
      kind: "FINAL",
      title: "Die Pipettierer steht im Final!",
    });
  });

  it("drops advancement of unknown teams", () => {
    expect(describeEvent(ev("ADVANCED_FINAL", "f", "nope"), ctx)).toBeNull();
    expect(describeEvent(ev("ADVANCED_SEMIFINAL", "sf1", null), ctx)).toBeNull();
  });

  it("announces the champion, even without a known team", () => {
    expect(describeEvent(ev("CHAMPION", "f", "t2"), ctx)).toMatchObject({
      kind: "CHAMPION",
      title: "Placebo-Effekt ist PharmaPong Champion!",
    });
    expect(describeEvent(ev("CHAMPION", "f", null), ctx)?.title).toBe("Wir haben einen Champion!");
  });
});

describe("toAnnouncements", () => {
  it("collapses ASSIGNED + STARTED of one match into a single announcement", () => {
    const assigned = ev("MATCH_ASSIGNED", "m1");
    const started = ev("MATCH_STARTED", "m1");
    const out = toAnnouncements([assigned, started], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(started.id);
  });

  it("keeps order and lets CHAMPION supersede earlier announcements", () => {
    const out = toAnnouncements(
      [ev("MATCH_STARTED", "m1"), ev("ADVANCED_FINAL", "f", "t1"), ev("CHAMPION", "f", "t1")],
      ctx,
    );
    expect(out.map((a) => a.kind)).toEqual(["CHAMPION"]);
    const later = toAnnouncements([ev("CHAMPION", "f", "t1"), ev("MATCH_STARTED", "m1")], ctx);
    expect(later.map((a) => a.kind)).toEqual(["CHAMPION", "NEW_MATCH"]);
  });
});

describe("receiveEvents", () => {
  it("never announces events that were present at page load", () => {
    const initial = [ev("MATCH_STARTED", "m1"), ev("ADVANCED_SEMIFINAL", "sf1", "t1")];
    const state = initAnnouncements(initial);
    expect(receiveEvents(state, initial, ctx)).toBe(state);
  });

  it("announces only new ids and remembers them", () => {
    const old = ev("MATCH_STARTED", "m1");
    const s0 = initAnnouncements([old]);
    const fresh = ev("ADVANCED_FINAL", "f", "t2");
    const s1 = receiveEvents(s0, [old, fresh], ctx);
    expect(s1.queue.map((a) => a.id)).toEqual([fresh.id]);
    expect(s1.seen.has(fresh.id)).toBe(true);
    // Same events again: nothing new.
    expect(receiveEvents(s1, [old, fresh], ctx)).toBe(s1);
  });

  it("detects new events even when old ones scrolled out of the window", () => {
    const s0 = initAnnouncements([ev("MATCH_STARTED", "m1")]);
    const a = ev("ADVANCED_SEMIFINAL", "sf1", "t3");
    expect(unseenEvents([a], s0.seen)).toEqual([a]);
    expect(receiveEvents(s0, [a], ctx).queue).toHaveLength(1);
  });

  it("dismisses only the head of the queue", () => {
    const s0 = initAnnouncements([]);
    const e1 = ev("ADVANCED_SEMIFINAL", "sf1", "t1");
    const e2 = ev("ADVANCED_SEMIFINAL", "sf1", "t3");
    const s1 = receiveEvents(s0, [e1, e2], ctx);
    expect(dismissAnnouncement(s1, e2.id)).toBe(s1);
    const s2 = dismissAnnouncement(s1, e1.id);
    expect(s2.queue.map((a) => a.id)).toEqual([e2.id]);
  });
});

describe("enqueueAnnouncements", () => {
  const mk = (id: string, kind: Announcement["kind"] = "NEW_MATCH"): Announcement => ({
    id,
    kind,
    title: id,
    subtitle: null,
    matchId: null,
    teamId: null,
    tableNumber: null,
  });

  it("drops duplicates and caps the backlog, keeping the newest", () => {
    const many = Array.from({ length: 10 }, (_, i) => mk(`a${i}`));
    const q = enqueueAnnouncements([mk("a0")], many);
    expect(q).toHaveLength(ANNOUNCEMENT_QUEUE_MAX);
    expect(q.at(-1)?.id).toBe("a9");
    expect(new Set(q.map((a) => a.id)).size).toBe(q.length);
  });

  it("removes everything queued before a champion", () => {
    const q = enqueueAnnouncements([mk("x"), mk("y")], [mk("c", "CHAMPION")]);
    expect(q.map((a) => a.id)).toEqual(["c"]);
  });
});
