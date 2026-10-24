import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { AdminTeams } from "@/components/admin/teams/admin-teams";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { requirePageUser } from "@/server/auth/current";
import { getTournamentStatus, listTeamsAdmin } from "@/server/services/teams";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Admin · Teams" };
export const dynamic = "force-dynamic";

export default async function AdminTeamsPage() {
  const user = await requirePageUser("ADMIN", "/admin/teams");
  const tournament = await getTournamentStatus();
  if (!tournament) {
    return (
      <>
        <PageTitle kicker="Turnierleitung" title="Teams" />
        <EmptyState icon={<CalendarClock />} title="Noch kein Turnier" />
      </>
    );
  }
  const [teams, users] = await Promise.all([listTeamsAdmin(user, tournament.id), listUsers(user)]);
  const freeUsers = users
    .filter((u) => u.isActive && !u.team)
    .map((u) => ({ id: u.id, displayName: u.displayName, email: u.email }));
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Teams" />
      <AdminTeams
        status={tournament.status}
        freeUsers={freeUsers}
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          motto: t.motto,
          logoUrl: t.logoUrl,
          status: t.status,
          inviteCode: t.inviteCode,
          complete: t.complete,
          allReady: t.allReady,
          members: t.members,
        }))}
      />
    </>
  );
}
