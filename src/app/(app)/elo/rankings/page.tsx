import type { Metadata } from "next";
import { Medal } from "lucide-react";
import { EloRankings } from "@/components/elo/elo-rankings";
import { loadEloInitial } from "@/components/elo/load-elo";
import { EmptyState, PageTitle } from "@/components/pp/section";

export const metadata: Metadata = { title: "Elo-Rangliste" };
export const dynamic = "force-dynamic";

export default async function EloRankingsPage() {
  const elo = await loadEloInitial();
  if (elo.mode === "none") {
    return (
      <>
        <PageTitle kicker="Elo-Modus" title="Rangliste" />
        <EmptyState icon={<Medal />} title="Noch keine Elo-Runde">
          <p>Sobald die Turnierleitung eine Elo-Runde eröffnet, erscheint hier die Rangliste.</p>
        </EmptyState>
      </>
    );
  }
  return (
    <EloRankings
      mode={elo.mode}
      initial={elo.snapshot}
      mustChangePassword={elo.mode !== "authed" && elo.loggedIn}
    />
  );
}
