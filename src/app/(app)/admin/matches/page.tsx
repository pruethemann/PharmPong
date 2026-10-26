import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { AdminMatches } from "@/components/admin/matches/admin-matches";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { EloModeBanner } from "@/components/elo/elo-banners";
import { requirePageUser } from "@/server/auth/current";
import { getActiveGameMode } from "@/server/services/current-mode";
import { buildAuthedSnapshot } from "@/server/services/live-snapshot";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Admin · Spiele" };
export const dynamic = "force-dynamic";

export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("ADMIN", "/admin/matches");
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) {
    return (
      <>
        <PageTitle kicker="Turnierleitung" title="Spiele" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier" />
      </>
    );
  }
  const [snapshot, sp] = await Promise.all([buildAuthedSnapshot(user, tournamentId), searchParams]);
  const raw = typeof sp.match === "string" ? sp.match : null;
  const initialMatchId = raw && snapshot.matches.some((m) => m.id === raw) ? raw : null;
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Spiele" />
      {(await getActiveGameMode()) === "ELO" && (
        <EloModeBanner href="/admin/elo" cta="Zur Elo-Verwaltung">
          Gerade läuft der Elo-Modus: Turnierspiele werden nicht zugewiesen. Die Tische und Elo-Matches
          verwaltest du unter Admin › Elo.
        </EloModeBanner>
      )}
      <AdminMatches initial={snapshot} initialMatchId={initialMatchId} />
    </>
  );
}
