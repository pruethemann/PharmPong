import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { EloAdmin } from "@/components/admin/elo/elo-admin";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { requirePageUser } from "@/server/auth/current";
import { getEloSessionAdmin, listEloMatchesAdmin, listEloRuns } from "@/server/services/elo-read";
import { buildEloAuthedSnapshot } from "@/server/services/elo-snapshot";
import { getModeStatus } from "@/server/services/game-mode";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Admin · Elo" };
export const dynamic = "force-dynamic";

export default async function AdminEloPage() {
  const user = await requirePageUser("ADMIN", "/admin/elo");
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId) {
    return (
      <>
        <PageTitle kicker="Turnierleitung" title="Elo-Modus" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier" />
      </>
    );
  }
  const [snapshot, session, mode] = await Promise.all([
    buildEloAuthedSnapshot(user, tournamentId),
    getEloSessionAdmin(user, tournamentId),
    getModeStatus(user),
  ]);
  const [matches, runs] = session
    ? await Promise.all([listEloMatchesAdmin(user, { sessionId: session.id }), listEloRuns(user, session.id)])
    : [[], []];
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Elo-Modus" />
      <EloAdmin
        initial={snapshot}
        session={session}
        matches={matches}
        runs={runs}
        mode={{ gameMode: mode.gameMode, blockers: mode.blockers }}
      />
    </>
  );
}
