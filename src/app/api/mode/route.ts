// Active game mode of the event, polled by every page (ModeWatch) so all clients follow a switch.
// Public: the mode is not private, and the reply is a few bytes.
import { readGameMode } from "@/server/services/game-mode";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { gameMode } = await readGameMode();
  return Response.json({ gameMode }, { headers: { "Cache-Control": "no-store" } });
}
