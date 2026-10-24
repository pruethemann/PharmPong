"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as tournament from "@/server/services/tournament";
import * as tiebreaks from "@/server/services/tiebreaks";
import * as tables from "@/server/services/tables";
import { defineAction } from "./define-action";

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/tournament");
  revalidatePath("/");
  revalidatePath("/display");
  revalidatePath("/referee");
}

const id = z.string().min(1).max(64);
const reason = z.string().trim().min(3, "Mindestens 3 Zeichen.").max(500, "Höchstens 500 Zeichen.");
const empty = z.object({});

// ─── Settings & registration ───────────────────────────────────────────────

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Mindestens 2 Zeichen.").max(80, "Höchstens 80 Zeichen.").optional(),
  matchDurationSec: z.coerce
    .number()
    .int()
    .min(300, "Mindestens 5 Minuten.")
    .max(3600, "Höchstens 60 Minuten.")
    .optional(),
  bombRuleEnabled: z.boolean().optional(),
  publicDisplayEnabled: z.boolean().optional(),
});
const _updateSettings = defineAction({
  schema: settingsSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tournament.updateSettings(user!, input);
    refresh();
    revalidatePath("/rules");
    return r;
  },
});
export async function updateSettingsAction(input: z.input<typeof settingsSchema>) {
  return _updateSettings(input);
}

const _openRegistration = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.openRegistration(user!);
    refresh();
    revalidatePath("/team");
    return r;
  },
});
export async function openRegistrationAction() {
  return _openRegistration({});
}

const _lockRegistration = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.lockRegistration(user!);
    refresh();
    revalidatePath("/team");
    return r;
  },
});
export async function lockRegistrationAction() {
  return _lockRegistration({});
}

const _reopenRegistration = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.reopenRegistration(user!);
    refresh();
    revalidatePath("/team");
    return r;
  },
});
export async function reopenRegistrationAction() {
  return _reopenRegistration({});
}

const cancelSchema = z.object({ reason, confirmText: z.string().max(100) });
const _cancelTournament = defineAction({
  schema: cancelSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tournament.cancelTournament(user!, input);
    refresh();
    return r;
  },
});
export async function cancelTournamentAction(input: z.input<typeof cancelSchema>) {
  return _cancelTournament(input);
}

// ─── Draw & stages ─────────────────────────────────────────────────────────

const _generateDraw = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.generateDraw(user!);
    refresh();
    return r;
  },
});
export async function generateDrawAction() {
  return _generateDraw({});
}

const _startGroupStage = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.startGroupStage(user!);
    refresh();
    return r;
  },
});
export async function startGroupStageAction() {
  return _startGroupStage({});
}

const resetDrawSchema = z.object({
  reason: z.string().trim().min(5, "Mindestens 5 Zeichen.").max(500, "Höchstens 500 Zeichen."),
  confirmText: z.string().max(100),
});
const _resetDraw = defineAction({
  schema: resetDrawSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tournament.resetDraw(user!, input);
    refresh();
    return r;
  },
});
export async function resetDrawAction(input: z.input<typeof resetDrawSchema>) {
  return _resetDraw(input);
}

const _startKnockout = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.startKnockout(user!);
    refresh();
    return r;
  },
});
export async function startKnockoutAction() {
  return _startKnockout({});
}

// ─── Pause ─────────────────────────────────────────────────────────────────

const pauseSchema = z.object({ reason: z.string().trim().max(500).optional() });
const _pauseTournament = defineAction({
  schema: pauseSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tournament.pauseTournament(user!, input);
    refresh();
    return r;
  },
});
export async function pauseTournamentAction(input: z.input<typeof pauseSchema> = {}) {
  return _pauseTournament(input);
}

const _resumeTournament = defineAction({
  schema: empty,
  access: "ADMIN",
  handler: async (_i, { user }) => {
    const r = await tournament.resumeTournament(user!);
    refresh();
    return r;
  },
});
export async function resumeTournamentAction() {
  return _resumeTournament({});
}

// ─── Ranking shootouts ─────────────────────────────────────────────────────

const recordShootoutSchema = z.object({
  group: z.enum(["A", "B", "C", "D"]),
  basisHash: z.string().min(1).max(128),
  orderedTeamIds: z.array(id).min(2).max(3),
  note: z.string().trim().max(500).optional().nullable(),
});
const _recordShootout = defineAction({
  schema: recordShootoutSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tiebreaks.recordRankingShootout(user!, input);
    refresh();
    return r;
  },
});
export async function recordRankingShootoutAction(input: z.input<typeof recordShootoutSchema>) {
  return _recordShootout(input);
}

const voidShootoutSchema = z.object({ tiebreakId: id, reason });
const _voidShootout = defineAction({
  schema: voidShootoutSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tiebreaks.voidRankingShootout(user!, input.tiebreakId, input.reason);
    refresh();
    return r;
  },
});
export async function voidRankingShootoutAction(input: z.input<typeof voidShootoutSchema>) {
  return _voidShootout(input);
}

// ─── Tables ────────────────────────────────────────────────────────────────

const tableDisabledSchema = z.object({
  tableId: id,
  disabled: z.boolean(),
  reason: z.string().trim().max(500).default(""),
});
const _setTableDisabled = defineAction({
  schema: tableDisabledSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tables.setTableDisabled(user!, input.tableId, input.disabled, input.reason);
    refresh();
    return r;
  },
});
export async function setTableDisabledAction(input: z.input<typeof tableDisabledSchema>) {
  return _setTableDisabled(input);
}

const renameTableSchema = z.object({
  tableId: id,
  name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(40, "Höchstens 40 Zeichen."),
});
const _renameTable = defineAction({
  schema: renameTableSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await tables.renameTable(user!, input.tableId, input.name);
    refresh();
    return r;
  },
});
export async function renameTableAction(input: z.input<typeof renameTableSchema>) {
  return _renameTable(input);
}
