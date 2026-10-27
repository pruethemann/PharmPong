import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "validation.emailTooLong")
  .pipe(z.email("validation.emailInvalid"));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, "validation.passwordMin")
  .max(PASSWORD_MAX, "validation.passwordMax");

export const displayNameSchema = z.string().trim().min(2, "validation.nameMin").max(40, "validation.nameMax");

export const registerSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  eventCode: z.string().trim().max(64).optional().default(""),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "validation.passwordRequired").max(PASSWORD_MAX),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "validation.currentPasswordRequired").max(PASSWORD_MAX),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({ displayName: displayNameSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});
