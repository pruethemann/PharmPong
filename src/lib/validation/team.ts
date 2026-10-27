import { z } from "zod";

export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 32;
export const MOTTO_MAX = 80;
export const REASON_MIN = 3;
export const REASON_MAX = 300;

/** Trim and collapse internal whitespace. This is the stored display form. */
export function cleanTeamName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/** Uniqueness key: trimmed, collapsed whitespace, lowercased. */
export function normalizeTeamName(input: string): string {
  return cleanTeamName(input).toLowerCase();
}

export const teamNameSchema = z
  .string({ error: "validation.teamNameRequired" })
  .transform(cleanTeamName)
  .pipe(z.string().min(TEAM_NAME_MIN, "validation.teamNameMin").max(TEAM_NAME_MAX, "validation.teamNameMax"));

/** Optional motto; empty string becomes null. */
export const mottoSchema = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    const t = (v ?? "").trim().replace(/\s+/g, " ");
    return t.length ? t : null;
  })
  .pipe(z.string().max(MOTTO_MAX, "validation.mottoMax").nullable());

const id = z.string().min(1).max(64);
const reason = z
  .string()
  .trim()
  .min(REASON_MIN, "Bitte gib einen Grund an (mind. 3 Zeichen).")
  .max(REASON_MAX, `Höchstens ${REASON_MAX} Zeichen.`);

export const createTeamSchema = z.object({ name: teamNameSchema, motto: mottoSchema });

export const joinTeamSchema = z.object({
  code: z.string().trim().min(1, "validation.inviteCodeRequired").max(32, "validation.inviteCodeTooLong"),
});

export const updateTeamSchema = z.object({
  teamId: id,
  expectedVersion: z.number().int().min(0),
  name: teamNameSchema.optional(),
  motto: mottoSchema.optional(),
});

export const teamIdSchema = z.object({ teamId: id });
export const setReadySchema = z.object({ ready: z.boolean() });

export const adminRenameTeamSchema = z.object({ teamId: id, name: teamNameSchema, reason });
export const adminSetMottoSchema = z.object({ teamId: id, motto: mottoSchema, reason });
export const adminMemberSchema = z.object({ teamId: id, userId: id, reason });
export const adminReplaceMemberSchema = z.object({ teamId: id, oldUserId: id, newUserId: id, reason });
export const adminDissolveTeamSchema = z.object({ teamId: id, reason });
export const adminCreateTeamSchema = z.object({
  name: teamNameSchema,
  motto: mottoSchema,
  memberUserIds: z
    .array(id)
    .max(2, "Ein Team hat höchstens 2 Mitglieder.")
    .refine((ids) => new Set(ids).size === ids.length, "Mitglieder doppelt ausgewählt."),
  reason,
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
