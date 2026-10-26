import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { TournamentAdmin } from "@/components/admin/tournament/tournament-admin";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { EloModeBanner } from "@/components/elo/elo-banners";
import { requirePageUser } from "@/server/auth/current";
import { getActiveGameMode } from "@/server/services/current-mode";
import { listTiebreaks } from "@/server/services/admin-read";
import { buildAuthedSnapshot } from "@/server/services/live-snapshot";
import { getTournamentOverview } from "@/server/services/tournament";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Admin · Turnier" };
export const dynamic = "force-dynamic";

export default async function AdminTournamentPage() {
  const user = await requirePageUser("ADMIN", "/admin/tournament");
  const tournamentId = await getCurrentTournamentId();
  const overview = tournamentId ? await getTournamentOverview(tournamentId) : null;
  if (!tournamentId || !overview) {
    return (
      <>
        <PageTitle kicker="Turnierleitung" title="Turnier" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier" />
      </>
    );
  }
  const [snap, tiebreaks] = await Promise.all([
    buildAuthedSnapshot(user, tournamentId),
    listTiebreaks(user, tournamentId),
  ]);
  const groupMatches = snap.matches.filter((m) => m.stage === "GROUP");
  const teamById = new Map(snap.teams.map((t) => [t.id, t]));
  const ties = (snap.admin?.unresolvedTies ?? []).map((t) => ({
    group: t.group,
    basisHash: t.basisHash,
    positions: t.positions,
    teams: t.teamIds.map((id) => ({
      id,
      name: teamById.get(id)?.name ?? "?",
      logoUrl: teamById.get(id)?.logoUrl ?? null,
    })),
  }));
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Turnier" />
      {(await getActiveGameMode()) === "ELO" && (
        <EloModeBanner href="/admin/elo" cta="Zur Elo-Verwaltung">
          Gerade läuft der Elo-Modus: Turnierspiele werden nicht zugewiesen. Die Tische und Elo-Matches
          verwaltest du unter Admin › Elo.
        </EloModeBanner>
      )}
      <TournamentAdmin
        lifecycle={{
          status: overview.status,
          isPaused: overview.isPaused,
          drawExists: overview.drawGeneratedAt !== null || snap.matches.length > 0,
          completeTeams: overview.counts.completeTeams,
          incompleteTeams: overview.counts.incompleteTeams,
          requiredTeams: overview.counts.requiredTeams,
          groupMatchesTotal: groupMatches.length,
          groupMatchesDecided: groupMatches.filter(
            (m) => m.status === "COMPLETED" || m.status === "FORFEITED",
          ).length,
          unresolvedTieGroups: [...new Set(ties.map((t) => t.group))],
        }}
        settings={{
          name: overview.name,
          matchDurationSec: overview.matchDurationSec,
          bombRuleEnabled: overview.bombRuleEnabled,
          publicDisplayEnabled: overview.publicDisplayEnabled,
        }}
        runningMatches={
          snap.matches.filter((m) => m.status === "IN_PROGRESS" || m.status === "AWAITING_CONFIRMATION")
            .length
        }
        groups={snap.groups}
        teams={snap.teams}
        tables={snap.tables}
        ties={ties}
        tiebreaks={tiebreaks}
      />
    </>
  );
}
