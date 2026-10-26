import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayerProfile } from "@/components/elo/player-profile";
import { getCurrentUser } from "@/server/auth/current";
import { getEloPlayerProfile } from "@/server/services/elo-read";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getEloPlayerProfile((await params).id);
  return { title: profile ? `${profile.displayName}: Elo-Profil` : "Profil nicht gefunden" };
}

export default async function EloPlayerPage({ params }: Props) {
  const { id } = await params;
  const [profile, user] = await Promise.all([getEloPlayerProfile(id), getCurrentUser()]);
  if (!profile) notFound();
  return <PlayerProfile profile={profile} isMe={user?.id === profile.userId} />;
}
