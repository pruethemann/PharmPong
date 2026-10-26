"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Actor } from "@/server/auth/sessions";
import * as corrections from "@/server/services/elo-corrections";
import { verifyRatings } from "@/server/services/elo-ratings";
import { listEloMatchesAdmin, listEloRuns } from "@/server/services/elo-read";
import * as sessions from "@/server/services/elo-session";
import * as mode from "@/server/services/game-mode";
import { defineAction } from "./define-action";

// Schemas stay module-private: a "use server" file may only export async functions.
const id = z.string().trim().min(1, "ID fehlt.").max(64);
const version = z.number().int().min(0);
const idempotencyKey = z.string().trim().min(8).max(128);
const reason = (min: number) =>
  z.string().trim().min(min, `Bitte gib eine Begründung mit mindestens ${min} Zeichen an.`).max(500);
const confirmText = z.string().trim().max(64);
const side = z.enum(["A", "B"]);
const cups = z.number().int().min(0).max(10).nullable().optional();

const modeSchema = z.object({ mode: z.enum(["COMPETITIVE", "ELO"], "Unbekannter Spielmodus.") });
const emptySchema = z.object({});
const draftsSchema = z.object({ reason: reason(3) });
const displaySchema = z.object({ enabled: z.boolean() });
const openSchema = z.object({ name: z.string().trim().min(2, "Mindestens 2 Zeichen.").max(60).optional() });
const sessionRef = { sessionId: id, expectedConfigVersion: version };
const statusSchema = z.object({ ...sessionRef, status: z.enum(["OPEN", "PAUSED"]) });
const closeSchema = z.object({ ...sessionRef, confirmText });
const reopenSchema = z.object({ ...sessionRef, reason: reason(5) });
const settingsSchema = z.object({
  ...sessionRef,
  settings: z.object({
    minTeamSize: z.number().int().min(1).max(4),
    maxTeamSize: z.number().int().min(1).max(4),
    minGamesForChampion: z.number().int().min(0).max(100),
    softReminderMinutes: z.number().int().min(1).max(240).nullable(),
    resultPolicy: z.enum(["DUAL_TEAM_CONFIRMATION", "REFEREE_ONLY"]),
  }),
});
const paramsSchema = z.object({
  ...sessionRef,
  params: z.object({
    initialRating: z.number().min(0).max(10_000),
    kFactor: z.number().gt(0).max(100),
    ratingScale: z.number().min(10).max(1000),
    repeatMultipliers: z.array(z.number().min(0).max(1)).min(1).max(10),
  }),
  reason: z.string().trim().max(500).optional(),
  confirmText: confirmText.optional(),
});
const recalcSchema = z.object({ sessionId: id, reason: reason(5), confirmText });
const sessionSchema = z.object({ sessionId: id });
const correctSchema = z.object({
  matchId: id,
  expectedVersion: version,
  resultVersion: z.number().int().min(0),
  reason: reason(5),
  idempotencyKey,
  changes: z.object({
    winnerSide: side.optional(),
    endType: z.enum(["REGULAR", "CONCEDED"]).optional(),
    cupsRemainingA: cups,
    cupsRemainingB: cups,
    rated: z.boolean().optional(),
    sideA: z.array(id).min(1).max(4).optional(),
    sideB: z.array(id).min(1).max(4).optional(),
  }),
});
const voidSchema = z.object({ matchId: id, expectedVersion: version, reason: reason(5) });
const listSchema = z.object({
  sessionId: id,
  status: z
    .array(
      z.enum([
        "DRAFT",
        "IN_PROGRESS",
        "AWAITING_CONFIRMATION",
        "DISPUTED",
        "COMPLETED",
        "CANCELLED",
        "VOIDED",
      ]),
    )
    .optional(),
});

/** Mode and Elo admin changes affect navigation and every dashboard. */
function refreshAll() {
  revalidatePath("/", "layout");
}

function adminAction<S extends z.ZodType, R>(
  schema: S,
  run: (input: z.infer<S>, user: Actor) => Promise<R>,
  refresh = true,
) {
  return defineAction({
    schema,
    access: "ADMIN",
    handler: async (input, { user }) => {
      const r = await run(input, user!);
      if (refresh) refreshAll();
      return r;
    },
  });
}

// ─── Game mode ─────────────────────────────────────────────────────────────

const _setMode = adminAction(modeSchema, (input, user) => mode.setGameMode(user, input));
export async function setGameModeAction(input: z.input<typeof modeSchema>) {
  return _setMode(input);
}

const _modeStatus = adminAction(emptySchema, (_input, user) => mode.getModeStatus(user), false);
export async function getModeStatusAction(input: z.input<typeof emptySchema> = {}) {
  return _modeStatus(input);
}

const _cancelDrafts = adminAction(draftsSchema, (input, user) => mode.cancelEloDrafts(user, input));
export async function cancelEloDraftsAction(input: z.input<typeof draftsSchema>) {
  return _cancelDrafts(input);
}

const _display = adminAction(displaySchema, (input, user) => mode.setPublicDisplay(user, input));
export async function setPublicDisplayAction(input: z.input<typeof displaySchema>) {
  return _display(input);
}

// ─── Session ───────────────────────────────────────────────────────────────

const _open = adminAction(openSchema, (input, user) => sessions.openEloSession(user, input));
export async function openEloSessionAction(input: z.input<typeof openSchema>) {
  return _open(input);
}

const _status = adminAction(statusSchema, (input, user) => sessions.setEloSessionStatus(user, input));
export async function setEloSessionStatusAction(input: z.input<typeof statusSchema>) {
  return _status(input);
}

const _close = adminAction(closeSchema, (input, user) => sessions.closeEloSession(user, input));
export async function closeEloSessionAction(input: z.input<typeof closeSchema>) {
  return _close(input);
}

const _reopen = adminAction(reopenSchema, (input, user) => sessions.reopenEloSession(user, input));
export async function reopenEloSessionAction(input: z.input<typeof reopenSchema>) {
  return _reopen(input);
}

const _settings = adminAction(settingsSchema, (input, user) => sessions.updateEloSettings(user, input));
export async function updateEloSettingsAction(input: z.input<typeof settingsSchema>) {
  return _settings(input);
}

const _params = adminAction(paramsSchema, (input, user) => sessions.updateEloParams(user, input));
export async function updateEloParamsAction(input: z.input<typeof paramsSchema>) {
  return _params(input);
}

const _recalc = adminAction(recalcSchema, (input, user) => sessions.recalculateElo(user, input));
export async function recalculateEloAction(input: z.input<typeof recalcSchema>) {
  return _recalc(input);
}

/** Read-only "Prüfen": replay the session and compare with the stored ratings. */
const _verify = adminAction(sessionSchema, (input) => verifyRatings(input.sessionId), false);
export async function verifyEloRatingsAction(input: z.input<typeof sessionSchema>) {
  return _verify(input);
}

// ─── Corrections ───────────────────────────────────────────────────────────

const _correct = adminAction(correctSchema, (input, user) => corrections.correctEloMatch(user, input));
export async function correctEloMatchAction(input: z.input<typeof correctSchema>) {
  return _correct(input);
}

const _voidCompleted = adminAction(voidSchema, (input, user) =>
  corrections.voidCompletedEloMatch(user, input),
);
export async function voidCompletedEloMatchAction(input: z.input<typeof voidSchema>) {
  return _voidCompleted(input);
}

// ─── Admin reads ───────────────────────────────────────────────────────────

const _list = adminAction(listSchema, (input, user) => listEloMatchesAdmin(user, input), false);
export async function listEloMatchesAdminAction(input: z.input<typeof listSchema>) {
  return _list(input);
}

const _runs = adminAction(sessionSchema, (input, user) => listEloRuns(user, input.sessionId), false);
export async function listEloRunsAction(input: z.input<typeof sessionSchema>) {
  return _runs(input);
}
