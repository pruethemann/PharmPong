// Display announcements derived from PublicSnapshot.recentEvents. Pure, no React/DOM.
//
// The projector only announces events it has NOT seen since the page was loaded:
// everything present in the first snapshot counts as "seen" (no replay on reload).
import type { LiveEvent, LiveMatch, LiveTeam } from "./live-types";

export const ANNOUNCEMENT_DURATION_MS = 6000;
/** Never build up a long backlog (e.g. after a reconnect): keep only the newest few. */
export const ANNOUNCEMENT_QUEUE_MAX = 4;

export type AnnouncementKind = "NEW_MATCH" | "SEMIFINAL" | "FINAL" | "CHAMPION";

export type Announcement = {
  /** Id of the (last) underlying event. */
  id: string;
  kind: AnnouncementKind;
  title: string;
  subtitle: string | null;
  matchId: string | null;
  teamId: string | null;
  tableNumber: number | null;
};

export type AnnouncementContext = {
  matches: Pick<LiveMatch, "id" | "label" | "tableNumber" | "homeTeamId" | "awayTeamId">[];
  teams: Pick<LiveTeam, "id" | "name">[];
};

/** Ids of all events in a snapshot: the "already seen" baseline on page load. */
export function seenIds(events: readonly LiveEvent[]): Set<string> {
  return new Set(events.map((e) => e.id));
}

/** Events whose id is not in `seen`, in the snapshot order (oldest first). */
export function unseenEvents(events: readonly LiveEvent[], seen: ReadonlySet<string>): LiveEvent[] {
  return events.filter((e) => !seen.has(e.id));
}

function teamName(ctx: AnnouncementContext, id: string | null): string | null {
  if (!id) return null;
  return ctx.teams.find((t) => t.id === id)?.name ?? null;
}

function pairing(ctx: AnnouncementContext, match: AnnouncementContext["matches"][number] | undefined) {
  if (!match) return null;
  const home = teamName(ctx, match.homeTeamId);
  const away = teamName(ctx, match.awayTeamId);
  return home && away ? `${home} vs ${away}` : null;
}

/** One announcement for one event, or null if the event cannot be described. */
export function describeEvent(event: LiveEvent, ctx: AnnouncementContext): Announcement | null {
  const match = event.matchId ? ctx.matches.find((m) => m.id === event.matchId) : undefined;
  const base = { id: event.id, matchId: event.matchId, teamId: event.teamId };
  switch (event.type) {
    case "MATCH_ASSIGNED":
    case "MATCH_STARTED": {
      const table = match?.tableNumber ?? null;
      return {
        ...base,
        kind: "NEW_MATCH",
        title: table != null ? `Neues Spiel an Tisch ${table}` : "Neues Spiel",
        subtitle: pairing(ctx, match) ?? match?.label ?? null,
        tableNumber: table,
      };
    }
    case "ADVANCED_SEMIFINAL":
    case "ADVANCED_FINAL": {
      const name = teamName(ctx, event.teamId);
      if (!name) return null;
      const final = event.type === "ADVANCED_FINAL";
      return {
        ...base,
        kind: final ? "FINAL" : "SEMIFINAL",
        title: final ? `${name} steht im Final!` : `${name} steht im Halbfinal!`,
        subtitle: match?.label ?? null,
        tableNumber: null,
      };
    }
    case "CHAMPION": {
      const name = teamName(ctx, event.teamId);
      return {
        ...base,
        kind: "CHAMPION",
        title: name ? `${name} ist PharmaPong Champion!` : "Wir haben einen Champion!",
        subtitle: null,
        tableNumber: null,
      };
    }
  }
}

/**
 * Turns new events into announcements:
 * - ASSIGNED and STARTED of the same match collapse into one "Neues Spiel" (the later one wins),
 * - unknown teams/events are dropped,
 * - a CHAMPION announcement supersedes everything before it (the takeover is the finale).
 */
export function toAnnouncements(events: readonly LiveEvent[], ctx: AnnouncementContext): Announcement[] {
  const out: Announcement[] = [];
  for (const event of events) {
    const a = describeEvent(event, ctx);
    if (!a) continue;
    if (a.kind === "NEW_MATCH" && a.matchId) {
      const dup = out.findIndex((x) => x.kind === "NEW_MATCH" && x.matchId === a.matchId);
      if (dup !== -1) out.splice(dup, 1);
    }
    if (a.kind === "CHAMPION") out.length = 0;
    out.push(a);
  }
  return out;
}

/** Appends to the queue (dropping duplicates by id) and caps it, keeping the newest. */
export function enqueueAnnouncements(
  queue: readonly Announcement[],
  incoming: readonly Announcement[],
  max = ANNOUNCEMENT_QUEUE_MAX,
): Announcement[] {
  const ids = new Set(queue.map((a) => a.id));
  const merged = [...queue, ...incoming.filter((a) => !ids.has(a.id))];
  const champion = merged.findLastIndex((a) => a.kind === "CHAMPION");
  const tail = champion === -1 ? merged : merged.slice(champion);
  return tail.slice(-max);
}

export type AnnouncementState = { seen: ReadonlySet<string>; queue: Announcement[] };

/** Initial state from the first snapshot: nothing is announced for events that already happened. */
export function initAnnouncements(events: readonly LiveEvent[]): AnnouncementState {
  return { seen: seenIds(events), queue: [] };
}

/** Feed the latest recentEvents; returns the new state (same object if nothing changed). */
export function receiveEvents(
  state: AnnouncementState,
  events: readonly LiveEvent[],
  ctx: AnnouncementContext,
): AnnouncementState {
  const fresh = unseenEvents(events, state.seen);
  if (fresh.length === 0) return state;
  const seen = new Set(state.seen);
  for (const e of fresh) seen.add(e.id);
  return { seen, queue: enqueueAnnouncements(state.queue, toAnnouncements(fresh, ctx)) };
}

/** Removes the head of the queue (after it has been shown for ANNOUNCEMENT_DURATION_MS). */
export function dismissAnnouncement(state: AnnouncementState, id: string): AnnouncementState {
  if (state.queue[0]?.id !== id) return state;
  return { seen: state.seen, queue: state.queue.slice(1) };
}
