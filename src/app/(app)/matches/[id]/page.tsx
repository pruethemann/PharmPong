import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatchDetailView } from "@/components/match/match-detail-view";
import { getCurrentUser, hasRole } from "@/server/auth/current";
import { buildAuthedSnapshot, buildPublicSnapshot } from "@/server/services/live-snapshot";
import { getMatchDetail } from "@/server/services/match-detail";
import { getCurrentTournamentId } from "@/server/services/tx";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await getMatchDetail(id);
  if (!detail) return { title: "Spiel nicht gefunden" };
  const h = detail.home?.name ?? detail.homeSourceLabel ?? "Offen";
  const a = detail.away?.name ?? detail.awaySourceLabel ?? "Offen";
  return { title: `${detail.label}: ${h} vs ${a}` };
}

export default async function MatchPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  const isReferee = hasRole(user, "REFEREE");
  const detail = await getMatchDetail(id, { includeIssues: isReferee });
  if (!detail) notFound();

  // Live updates only for matches of the current tournament.
  const currentId = await getCurrentTournamentId();
  const isCurrent = currentId === detail.tournamentId;
  const signedIn = !!user && !user.mustChangePassword;
  let live: {
    endpoint: "/api/live" | "/api/live/public";
    initial: Awaited<ReturnType<typeof buildPublicSnapshot>>;
  } | null = null;
  if (isCurrent && signedIn) {
    live = { endpoint: "/api/live", initial: await buildAuthedSnapshot(user, detail.tournamentId) };
  } else if (isCurrent && detail.publicDisplayEnabled) {
    live = { endpoint: "/api/live/public", initial: await buildPublicSnapshot(detail.tournamentId) };
  }

  return <MatchDetailView detail={detail} live={live} role={user?.role ?? null} />;
}
