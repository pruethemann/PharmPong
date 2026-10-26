import "server-only";
import { getCurrentUser } from "@/server/auth/current";
import { buildEloAuthedSnapshot, buildEloPublicSnapshot } from "@/server/services/elo-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";
import type { EloLiveMode, EloSnapshot } from "./elo-live";

export type EloInitial =
  { mode: "none"; loggedIn: boolean } | { mode: EloLiveMode; snapshot: EloSnapshot; loggedIn: boolean };

/**
 * Initial data for the Elo pages, mirroring loadLiveInitial: signed in → authenticated snapshot
 * (polled); otherwise the public snapshot, polled when the admin enabled sharing, else rendered once.
 */
export async function loadEloInitial(): Promise<EloInitial> {
  const user = await getCurrentUser();
  const authed = user && !user.mustChangePassword ? user : null;
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) return { mode: "none", loggedIn: !!user };
  if (authed)
    return { mode: "authed", snapshot: await buildEloAuthedSnapshot(authed, tournamentId), loggedIn: true };
  const snapshot = await buildEloPublicSnapshot(tournamentId);
  return { mode: snapshot.tournament.publicDisplayEnabled ? "public" : "static", snapshot, loggedIn: !!user };
}
