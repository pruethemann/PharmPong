import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

/** Bottom-nav target "Profil": the signed-in player's own Elo profile. */
export default async function MyEloProfilePage() {
  const user = await requirePageUser("PLAYER", "/elo/players/me");
  redirect(`/elo/players/${user.id}`);
}
