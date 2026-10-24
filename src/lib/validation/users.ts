import { z } from "zod";
import { emailSchema } from "./auth";

const userId = z.string().trim().min(1, "Benutzer fehlt.").max(64);

export const roleSchema = z.enum(["PLAYER", "REFEREE", "ADMIN"], "Ungültige Rolle.");

export const listUsersSchema = z.object({
  query: z.string().trim().max(100).optional(),
});

export const setRoleSchema = z.object({ userId, role: roleSchema });

export const setActiveSchema = z.object({ userId, isActive: z.boolean() });

export const userIdSchema = z.object({ userId });

// Empty string = unlock everything; otherwise it must be a full, valid email address.
export const unlockLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), emailSchema]))
    .optional(),
});

export const emptySchema = z.object({}).optional();
