"use server";

// Read-only Server Actions for admin client components (admin-read service).
import { z } from "zod";
import { defineAction } from "@/server/actions/define-action";
import { listMatchEvents } from "@/server/services/admin-read";

const matchIdSchema = z.object({ matchId: z.string().trim().min(1).max(64) });

const _events = defineAction({
  schema: matchIdSchema,
  access: "ADMIN",
  handler: async (input, { user }) => listMatchEvents(user!, input.matchId),
});
export async function getMatchEventsAction(input: z.input<typeof matchIdSchema>) {
  return _events(input);
}
