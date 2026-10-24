// Authenticated live snapshot (polling). See src/lib/live-types.ts for the contract.
import { getCurrentUser, touchSession } from "@/server/auth/current";
import { handleAuthedLive } from "@/server/services/live-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (user) {
    // Slide the session for long-running dashboards; never fail the poll because of it.
    await touchSession().catch(() => {});
  }
  return handleAuthedLive(req, user);
}
