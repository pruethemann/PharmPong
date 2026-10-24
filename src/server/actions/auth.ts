"use server";

import { z } from "zod";
import {
  clearSessionCookie,
  clientIp,
  currentSessionId,
  readSessionToken,
  setSessionCookie,
  userAgent,
} from "@/server/auth/current";
import { deleteSessionByToken } from "@/server/auth/sessions";
import { env } from "@/server/env";
import * as auth from "@/server/services/auth";
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { defineAction } from "./define-action";

const _register = defineAction({
  schema: registerSchema,
  access: "public",
  handler: async (input) => {
    const { token, expiresAt, user } = await auth.registerUser(input, {
      ip: await clientIp(),
      userAgent: await userAgent(),
      requiredEventCode: env().EVENT_CODE || undefined,
    });
    await setSessionCookie(token, expiresAt);
    return { userId: user.id };
  },
});
export async function registerAction(input: z.input<typeof registerSchema>) {
  return _register(input);
}

const _login = defineAction({
  schema: loginSchema,
  access: "public",
  handler: async (input) => {
    const { token, expiresAt, user } = await auth.login(input, {
      ip: await clientIp(),
      userAgent: await userAgent(),
    });
    await setSessionCookie(token, expiresAt);
    return { role: user.role, mustChangePassword: user.mustChangePassword };
  },
});
export async function loginAction(input: z.input<typeof loginSchema>) {
  return _login(input);
}

export async function logoutAction(): Promise<{ ok: true }> {
  const token = await readSessionToken();
  if (token) await deleteSessionByToken(token);
  await clearSessionCookie();
  return { ok: true };
}

const _changePassword = defineAction({
  schema: changePasswordSchema,
  access: "PLAYER",
  handler: async (input, { user }) => auth.changePassword(user!, input, await currentSessionId()),
});
export async function changePasswordAction(input: z.input<typeof changePasswordSchema>) {
  return _changePassword(input);
}

const _updateProfile = defineAction({
  schema: profileSchema,
  access: "PLAYER",
  handler: async (input, { user }) => auth.updateProfile(user!, input),
});
export async function updateProfileAction(input: z.input<typeof profileSchema>) {
  return _updateProfile(input);
}

const _redeemReset = defineAction({
  schema: resetPasswordSchema,
  access: "public",
  handler: async (input) => auth.redeemPasswordReset(input, { ip: await clientIp() }),
});
export async function redeemResetAction(input: z.input<typeof resetPasswordSchema>) {
  return _redeemReset(input);
}
