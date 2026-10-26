import { buildPublicSnapshot, readLiveHead } from "@/server/services/live-snapshot";
import { getActiveGameMode } from "@/server/services/current-mode";
import { buildEloPublicSnapshot } from "@/server/services/elo-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";
import type { DisplayPanel } from "@/lib/display-rotation";
import { DisplayDisabled } from "@/components/display/display-disabled";
import { DisplayScreen } from "@/components/display/display-screen";
import { EloDisplayScreen } from "@/components/elo/elo-display";
import { ModeWatch } from "@/components/pp/mode-watch";

export const dynamic = "force-dynamic";

/** Public projector view. No auth; only when the admin enabled public sharing. */
const PANELS: DisplayPanel[] = ["groups", "bracket", "upNext", "teams"];

export default async function DisplayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { panel } = await searchParams;
  const pinned = PANELS.find((p) => p === panel) ?? null;
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) return <DisplayDisabled reason="none" />;
  const head = await readLiveHead(tournamentId);
  if (!head?.publicDisplayEnabled) return <DisplayDisabled reason="disabled" />;
  // The projector follows the admin's mode switch (ModeWatch re-renders this page).
  const mode = await getActiveGameMode();
  if (mode === "ELO") {
    const snapshot = await buildEloPublicSnapshot(tournamentId);
    if (!snapshot.tournament.publicDisplayEnabled) return <DisplayDisabled reason="disabled" />;
    return (
      <>
        <EloDisplayScreen initial={snapshot} />
        <ModeWatch mode="ELO" />
      </>
    );
  }
  const snapshot = await buildPublicSnapshot(tournamentId);
  if (!snapshot.tournament.publicDisplayEnabled) return <DisplayDisabled reason="disabled" />;
  return (
    <>
      <DisplayScreen initial={snapshot} pinnedPanel={pinned} />
      <ModeWatch mode="COMPETITIVE" />
    </>
  );
}
