// Admin download of the tournament export: ?format=json|standings.csv|matches.csv.
// 401 without a session, 403 for non-admins. See src/server/services/export.ts.
import { getCurrentUser } from "@/server/auth/current";
import { handleExportRequest } from "@/server/services/export";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  return handleExportRequest(req, user);
}
