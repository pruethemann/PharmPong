"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as eloMatches from "@/server/services/elo-matches";
import * as eloResults from "@/server/services/elo-results";
import { getEloMatchDetail, getEloPlayerProfile } from "@/server/services/elo-read";
import { defineAction } from "./define-action";

// Schemas stay module-private: a "use server" file may only export async functions.
const id = z.string().trim().min(1, "ID fehlt.").max(64);
const version = z.number().int().min(0);
const idempotencyKey = z.string().trim().min(8).max(128);
const side = z.enum(["A", "B"], "Team A oder Team B.");
const roster = z.array(id).max(4, "Höchstens 4 Spieler:innen pro Team.");
const rosterHash = z.string().trim().min(16).max(128);
const cups = z
  .number()
  .int("Ganze Zahl erwartet.")
  .min(0, "Mindestens 0.")
  .max(10, "Höchstens 10.")
  .nullable()
  .optional();
const resultFields = {
  winnerSide: side,
  endType: z.enum(["REGULAR", "CONCEDED"], "Ungültige Art des Spielendes."),
  cupsRemainingA: cups,
  cupsRemainingB: cups,
};
const note = z.string().trim().max(300, "Höchstens 300 Zeichen.").optional();
const reason = (min: number) =>
  z.string().trim().min(min, `Bitte gib eine Begründung mit mindestens ${min} Zeichen an.`).max(500);

const createSchema = z.object({ tableId: id, sideA: roster, sideB: roster, rated: z.boolean() });
const rosterSchema = z.object({
  matchId: id,
  expectedVersion: version,
  sideA: roster,
  sideB: roster,
  rated: z.boolean(),
  tableId: id.optional(),
});
const consentSchema = z.object({ matchId: id, rosterHash });
const staffConsentSchema = z.object({ matchId: id, rosterHash, sides: z.array(side).min(1).max(2), note });
const matchSchema = z.object({ matchId: id });
const versionedSchema = z.object({ matchId: id, expectedVersion: version });
const cancelSchema = z.object({
  matchId: id,
  expectedVersion: version.optional(),
  reason: z.string().trim().max(500).optional(),
});
const abandonSchema = z.object({ matchId: id, expectedVersion: version, reason: reason(3) });
const submitSchema = z.object({ matchId: id, expectedVersion: version, idempotencyKey, ...resultFields });
const confirmSchema = z.object({ matchId: id, resultVersion: z.number().int().min(0), idempotencyKey });
const disputeSchema = z.object({ matchId: id, resultVersion: z.number().int().min(0), note, idempotencyKey });
const staffFinalSchema = z.object({
  matchId: id,
  expectedVersion: version,
  idempotencyKey,
  reason: z.string().trim().max(500).optional(),
  ...resultFields,
});
const voidSchema = z.object({ matchId: id, expectedVersion: version, reason: reason(3) });
const profileSchema = z.object({ userId: id });

/** Elo writes change the live data of every Elo page (they poll anyway; this refreshes navigations). */
function refreshElo() {
  revalidatePath("/", "layout");
}

function action<S extends z.ZodType, R>(
  schema: S,
  access: "PLAYER" | "REFEREE",
  run: (input: z.infer<S>, user: Parameters<typeof eloMatches.createEloMatch>[0]) => Promise<R>,
) {
  return defineAction({
    schema,
    access,
    handler: async (input, { user }) => {
      const r = await run(input, user!);
      refreshElo();
      return r;
    },
  });
}

// ─── Drafts and consent ────────────────────────────────────────────────────

const _create = action(createSchema, "PLAYER", (input, user) => eloMatches.createEloMatch(user, input));
export async function createEloMatchAction(input: z.input<typeof createSchema>) {
  return _create(input);
}

const _roster = action(rosterSchema, "PLAYER", (input, user) => eloMatches.updateEloRoster(user, input));
export async function updateEloRosterAction(input: z.input<typeof rosterSchema>) {
  return _roster(input);
}

const _consent = action(consentSchema, "PLAYER", (input, user) => eloMatches.consentEloRoster(user, input));
export async function consentEloRosterAction(input: z.input<typeof consentSchema>) {
  return _consent(input);
}

const _staffConsent = action(staffConsentSchema, "REFEREE", (input, user) =>
  eloMatches.staffConsentEloRoster(user, input),
);
export async function staffConsentEloRosterAction(input: z.input<typeof staffConsentSchema>) {
  return _staffConsent(input);
}

const _leave = action(matchSchema, "PLAYER", (input, user) => eloMatches.leaveEloMatch(user, input));
export async function leaveEloMatchAction(input: z.input<typeof matchSchema>) {
  return _leave(input);
}

const _cancel = action(cancelSchema, "PLAYER", (input, user) => eloMatches.cancelEloMatch(user, input));
export async function cancelEloMatchAction(input: z.input<typeof cancelSchema>) {
  return _cancel(input);
}

// ─── Clock ─────────────────────────────────────────────────────────────────

const _start = action(versionedSchema, "PLAYER", (input, user) => eloMatches.startEloMatch(user, input));
export async function startEloMatchAction(input: z.input<typeof versionedSchema>) {
  return _start(input);
}

const _pause = action(versionedSchema, "PLAYER", (input, user) => eloMatches.pauseEloMatch(user, input));
export async function pauseEloMatchAction(input: z.input<typeof versionedSchema>) {
  return _pause(input);
}

const _resume = action(versionedSchema, "PLAYER", (input, user) => eloMatches.resumeEloMatch(user, input));
export async function resumeEloMatchAction(input: z.input<typeof versionedSchema>) {
  return _resume(input);
}

const _abandon = action(abandonSchema, "REFEREE", (input, user) => eloMatches.abandonEloMatch(user, input));
export async function abandonEloMatchAction(input: z.input<typeof abandonSchema>) {
  return _abandon(input);
}

// ─── Results ───────────────────────────────────────────────────────────────

const _submit = action(submitSchema, "PLAYER", (input, user) => eloResults.submitEloResult(user, input));
export async function submitEloResultAction(input: z.input<typeof submitSchema>) {
  return _submit(input);
}

const _confirm = action(confirmSchema, "PLAYER", (input, user) => eloResults.confirmEloResult(user, input));
export async function confirmEloResultAction(input: z.input<typeof confirmSchema>) {
  return _confirm(input);
}

const _dispute = action(disputeSchema, "PLAYER", (input, user) => eloResults.disputeEloResult(user, input));
export async function disputeEloResultAction(input: z.input<typeof disputeSchema>) {
  return _dispute(input);
}

const _staffFinal = action(staffFinalSchema, "REFEREE", (input, user) =>
  eloResults.staffFinalizeEloResult(user, input),
);
export async function staffFinalizeEloResultAction(input: z.input<typeof staffFinalSchema>) {
  return _staffFinal(input);
}

const _void = action(voidSchema, "REFEREE", (input, user) => eloResults.voidEloResult(user, input));
export async function voidEloResultAction(input: z.input<typeof voidSchema>) {
  return _void(input);
}

// ─── Reads used by client components ───────────────────────────────────────

const _detail = defineAction({
  schema: matchSchema,
  access: "public",
  handler: async (input) => getEloMatchDetail(input.matchId),
});
export async function getEloMatchDetailAction(input: z.input<typeof matchSchema>) {
  return _detail(input);
}

const _profile = defineAction({
  schema: profileSchema,
  access: "public",
  handler: async (input) => getEloPlayerProfile(input.userId),
});
export async function getEloPlayerProfileAction(input: z.input<typeof profileSchema>) {
  return _profile(input);
}
