import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { loadLiveInitial, viewerOf } from "@/components/live/load-live";
import { TOURNAMENT_TABS, type TournamentTab } from "@/components/live/live-view";
import { TournamentView } from "@/components/live/tournament-view";
import { EloModeBanner } from "@/components/elo/elo-banners";
import { getActiveGameMode } from "@/server/services/current-mode";

export const metadata: Metadata = { title: "Turnier" };
export const dynamic = "force-dynamic";

export default async function TournamentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  const initialTab: TournamentTab = TOURNAMENT_TABS.find((t) => t === tab) ?? "gruppen";
  const live = await loadLiveInitial();
  if (live.mode === "none") {
    return (
      <>
        <PageTitle kicker="PharmaPong" title="Turnier" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier">
          Sobald die Turnierleitung das Turnier eröffnet, findest du hier Gruppen, Tableau und Spielplan.
        </EmptyState>
      </>
    );
  }
  const elo = (await getActiveGameMode()) === "ELO";
  return (
    <>
      {elo && <EloModeBanner />}
      <TournamentView
        mode={live.mode}
        initial={live.snapshot}
        initialTab={initialTab}
        mustChangePassword={viewerOf(live) === "mustChangePassword"}
      />
    </>
  );
}
