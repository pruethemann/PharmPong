// Public live snapshot for /display. 404 unless the admin enabled the public display.
import { handlePublicLive } from "@/server/services/live-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handlePublicLive(req);
}
