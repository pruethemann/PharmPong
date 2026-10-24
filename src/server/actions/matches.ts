"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as corrections from "@/server/services/corrections";
import * as matches from "@/server/services/matches";
import * as results from "@/server/services/results";
import { defineAction } from "./define-action";

// Schemas stay module-private: a "use server" file may only export async functions.
const id = z.string().trim().min(1, "ID fehlt.").max(64);
const version = z.number().int().min(0);
const idempotencyKey = z.string().trim().min(8).max(128);
const cups = z.number().int("Ganze Zahl erwartet.").min(0, "Mindestens 0.").max(10, "Höchstens 10.");
const endType = z.enum(["REGULAR", "TIME_LIMIT", "SHOOTOUT"], "Ungültige Art des Spielendes.");
const adminEndType = z.enum(
  ["REGULAR", "TIME_LIMIT", "SHOOTOUT", "FORFEIT"],
  "Ungültige Art des Spielendes.",
);
const reason = (min: number) =>
  z.string().trim().min(min, `Bitte gib eine Begründung mit mindestens ${min} Zeichen an.`).max(500);

const versionedSchema = z.object({ matchId: id, expectedVersion: version });
const assignSchema = z.object({ matchId: id, tableId: id, expectedVersion: version });
const abortSchema = z.object({ matchId: id, reason: reason(3), expectedVersion: version.optional() });
const reportIssueSchema = z.object({
  matchId: id,
  text: z.string().trim().min(3, "Mindestens 3 Zeichen.").max(300, "Höchstens 300 Zeichen."),
});
const resolveIssueSchema = z.object({ matchId: id, note: z.string().trim().max(300).optional() });
const resultFields = {
  winnerTeamId: id,
  homeCupsRemaining: cups,
  awayCupsRemaining: cups,
};
const proposeSchema = z.object({
  matchId: id,
  expectedVersion: version,
  idempotencyKey,
  ...resultFields,
  endType,
});
const confirmSchema = z.object({
  matchId: id,
  expectedVersion: version,
  resultRevision: z.number().int().min(0),
  idempotencyKey,
});
const forfeitSchema = z.object({
  matchId: id,
  winnerTeamId: id,
  reason: reason(3),
  expectedVersion: version.optional(),
});
const correctSchema = z.object({
  matchId: id,
  expectedVersion: version,
  reason: reason(5),
  ...resultFields,
  endType: adminEndType,
});
// newResult (optional) makes the plan exact for group corrections in the knockout phase.
const planSchema = z.object({
  matchId: id,
  newResult: z.object({ ...resultFields, endType: adminEndType }).optional(),
});
const recoverySchema = z.object({
  matchId: id,
  expectedVersion: version,
  reason: reason(5),
  confirmText: z.string().trim().max(64),
  newResult: z.object({ ...resultFields, endType: adminEndType }),
});

function revalidateMatchViews() {
  revalidatePath("/referee");
  revalidatePath("/admin");
  revalidatePath("/tournament");
}

// ─── Referee operations ────────────────────────────────────────────────────

const _assign = defineAction({
  schema: assignSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.assignMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function assignMatchAction(input: z.input<typeof assignSchema>) {
  return _assign(input);
}

const _unassign = defineAction({
  schema: versionedSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.unassignMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function unassignMatchAction(input: z.input<typeof versionedSchema>) {
  return _unassign(input);
}

const _start = defineAction({
  schema: versionedSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.startMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function startMatchAction(input: z.input<typeof versionedSchema>) {
  return _start(input);
}

const _pause = defineAction({
  schema: versionedSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.pauseMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function pauseMatchAction(input: z.input<typeof versionedSchema>) {
  return _pause(input);
}

const _resume = defineAction({
  schema: versionedSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.resumeMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function resumeMatchAction(input: z.input<typeof versionedSchema>) {
  return _resume(input);
}

const _reportIssue = defineAction({
  schema: reportIssueSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await matches.reportIssue(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function reportIssueAction(input: z.input<typeof reportIssueSchema>) {
  return _reportIssue(input);
}

const _propose = defineAction({
  schema: proposeSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await results.proposeResult(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function proposeResultAction(input: z.input<typeof proposeSchema>) {
  return _propose(input);
}

const _reject = defineAction({
  schema: versionedSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await results.rejectProposal(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function rejectProposalAction(input: z.input<typeof versionedSchema>) {
  return _reject(input);
}

const _confirm = defineAction({
  schema: confirmSchema,
  access: "REFEREE",
  handler: async (input, { user }) => {
    const r = await results.confirmResult(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function confirmResultAction(input: z.input<typeof confirmSchema>) {
  return _confirm(input);
}

// ─── Admin operations ──────────────────────────────────────────────────────

const _abort = defineAction({
  schema: abortSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await matches.abortMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function abortMatchAction(input: z.input<typeof abortSchema>) {
  return _abort(input);
}

const _resolveIssue = defineAction({
  schema: resolveIssueSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await matches.resolveIssue(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function resolveIssueAction(input: z.input<typeof resolveIssueSchema>) {
  return _resolveIssue(input);
}

const _forfeit = defineAction({
  schema: forfeitSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await results.forfeitMatch(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function forfeitMatchAction(input: z.input<typeof forfeitSchema>) {
  return _forfeit(input);
}

const _correct = defineAction({
  schema: correctSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await corrections.correctResult(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function correctResultAction(input: z.input<typeof correctSchema>) {
  return _correct(input);
}

const _planRecovery = defineAction({
  schema: planSchema,
  access: "ADMIN",
  handler: async (input, { user }) => corrections.planRecovery(user!, input),
});
export async function planRecoveryAction(input: z.input<typeof planSchema>) {
  return _planRecovery(input);
}

const _executeRecovery = defineAction({
  schema: recoverySchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await corrections.executeRecovery(user!, input);
    revalidateMatchViews();
    return r;
  },
});
export async function executeRecoveryAction(input: z.input<typeof recoverySchema>) {
  return _executeRecovery(input);
}
