// Authenticated Elo live snapshot (polling). See src/lib/elo-live-types.ts for the contract.
import { getCurrentUser, touchSession } from "@/server/auth/current";
import { handleEloAuthedLive } from "@/server/services/elo-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (user) {
    // Slide the session for long-running pages; never fail the poll because of it.
    await touchSession().catch(() => {});
  }
  return handleEloAuthedLive(req, user);
}
