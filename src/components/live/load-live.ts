import "server-only";
import { getCurrentUser } from "@/server/auth/current";
import { buildAuthedSnapshot, buildPublicSnapshot } from "@/server/services/live-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";
import type { AuthedSnapshot, PublicSnapshot } from "@/lib/live-types";
import type { LiveMode, Viewer } from "./live-view";

export function viewerOf(live: LiveInitial): Viewer {
  if (live.mode === "authed") return "member";
  return live.loggedIn ? "mustChangePassword" : "guest";
}

export type LiveInitial =
  | { mode: "none"; loggedIn: boolean }
  | { mode: "authed"; snapshot: AuthedSnapshot; loggedIn: true }
  | { mode: "public" | "static"; snapshot: PublicSnapshot; loggedIn: boolean };

/**
 * Initial data for the spectator pages (/ and /tournament):
 * signed in → authed snapshot + /api/live; otherwise the public snapshot, polled via
 * /api/live/public when the admin enabled public sharing, else rendered once (static).
 * The public snapshot never contains private data, so the static render is safe.
 */
export async function loadLiveInitial(): Promise<LiveInitial> {
  const user = await getCurrentUser();
  // Users that must change their initial password get 403 from /api/live: treat as guests.
  const authed = user && !user.mustChangePassword ? user : null;
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) return { mode: "none", loggedIn: !!user };
  if (authed) {
    const snapshot = await buildAuthedSnapshot(authed, tournamentId);
    return { mode: "authed", snapshot, loggedIn: true };
  }
  const snapshot = await buildPublicSnapshot(tournamentId);
  const mode: Exclude<LiveMode, "authed"> = snapshot.tournament.publicDisplayEnabled ? "public" : "static";
  return { mode, snapshot, loggedIn: !!user };
}
