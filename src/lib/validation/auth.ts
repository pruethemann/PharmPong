import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-Mail-Adresse ist zu lang.")
  .pipe(z.email("Bitte gib eine gültige E-Mail-Adresse ein."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Mindestens ${PASSWORD_MIN} Zeichen.`)
  .max(PASSWORD_MAX, `Höchstens ${PASSWORD_MAX} Zeichen.`);

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Mindestens 2 Zeichen.")
  .max(40, "Höchstens 40 Zeichen.");

export const registerSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  eventCode: z.string().trim().max(64).optional().default(""),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Bitte Passwort eingeben.").max(PASSWORD_MAX),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Bitte aktuelles Passwort eingeben.").max(PASSWORD_MAX),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({ displayName: displayNameSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});
