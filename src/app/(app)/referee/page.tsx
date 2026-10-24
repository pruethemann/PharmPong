import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { RefereeDashboard } from "@/components/referee/referee-dashboard";
import { requirePageUser } from "@/server/auth/current";
import { buildAuthedSnapshot } from "@/server/services/live-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Schiri-Modus" };
export const dynamic = "force-dynamic";

export default async function RefereePage() {
  const user = await requirePageUser("REFEREE", "/referee");
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) {
    return (
      <>
        <PageTitle kicker="Schiri-Modus" title="Mein Tisch" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier">
          Sobald die Turnierleitung das Turnier eingerichtet hat, erscheinen hier deine Tische.
        </EmptyState>
      </>
    );
  }
  const initial = await buildAuthedSnapshot(user, tournamentId);
  return <RefereeDashboard initial={initial} />;
}
