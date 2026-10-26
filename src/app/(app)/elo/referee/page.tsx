import type { Metadata } from "next";
import Link from "next/link";
import { Gavel } from "lucide-react";
import { StaffBoard } from "@/components/elo/staff-board";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { requirePageUser } from "@/server/auth/current";
import { getActiveGameMode } from "@/server/services/current-mode";
import { buildEloAuthedSnapshot } from "@/server/services/elo-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Schiri: Elo" };
export const dynamic = "force-dynamic";

export default async function EloRefereePage() {
  const user = await requirePageUser("REFEREE", "/elo/referee");
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId || (await getActiveGameMode()) !== "ELO") {
    return (
      <>
        <PageTitle kicker="Schiri-Modus · Elo" title="Schiri" />
        <EmptyState icon={<Gavel />} title="Elo-Modus nicht aktiv">
          <p>Gerade läuft das Turnier. Die Turnier-Schiri-Ansicht findest du unter «Schiri».</p>
          <Link href="/referee" className={buttonVariants({ variant: "outline", className: "mt-4" })}>
            Zur Turnier-Schiri-Ansicht
          </Link>
        </EmptyState>
      </>
    );
  }
  return <StaffBoard initial={await buildEloAuthedSnapshot(user, tournamentId)} />;
}
