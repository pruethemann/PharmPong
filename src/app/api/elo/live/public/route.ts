// Public Elo live snapshot for /display and guests. 404 unless the admin enabled the public display.
import { handleEloPublicLive } from "@/server/services/elo-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleEloPublicLive(req);
}
