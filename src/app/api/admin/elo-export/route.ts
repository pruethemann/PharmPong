// Admin download of the Elo session: ?format=json|rankings.csv|matches.csv[&sessionId=].
import { getCurrentUser } from "@/server/auth/current";
import { handleEloExportRequest } from "@/server/services/elo-export";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleEloExportRequest(req, await getCurrentUser());
}
