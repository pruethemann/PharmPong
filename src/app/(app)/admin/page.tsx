import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { AdminOverview } from "@/components/admin/overview/admin-overview";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { requirePageUser } from "@/server/auth/current";
import { buildAuthedSnapshot } from "@/server/services/live-snapshot";
import { listTeamsAdmin } from "@/server/services/teams";
import { getTournamentOverview } from "@/server/services/tournament";
import { getCurrentTournamentId } from "@/server/services/tx";
import { getUserCounts } from "@/server/services/users";

export const metadata: Metadata = { title: "Admin · Übersicht" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const user = await requirePageUser("ADMIN", "/admin");
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) {
    return (
      <>
        <PageTitle kicker="Turnierleitung" title="Übersicht" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier">
          Beim nächsten Serverstart wird automatisch ein Turnier angelegt.
        </EmptyState>
      </>
    );
  }
  const [snapshot, overview, userCounts, teams] = await Promise.all([
    buildAuthedSnapshot(user, tournamentId),
    getTournamentOverview(tournamentId),
    getUserCounts(user),
    listTeamsAdmin(user, tournamentId),
  ]);
  const incompleteTeams = teams
    .filter((t) => t.status === "ACTIVE" && !t.complete)
    .map((t) => ({ id: t.id, name: t.name }));
  const c = overview?.counts;
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Übersicht" />
      <AdminOverview
        initial={snapshot}
        incompleteTeams={incompleteTeams}
        counts={{
          registeredPlayers: c?.registeredPlayers ?? userCounts.players,
          playersInTeams: c?.players ?? 0,
          teams: c?.teams ?? 0,
          completeTeams: c?.completeTeams ?? 0,
          incompleteTeams: c?.incompleteTeams ?? 0,
          requiredTeams: c?.requiredTeams ?? 12,
          referees: userCounts.referees,
        }}
      />
    </>
  );
}
