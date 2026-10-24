"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as users from "@/server/services/users";
import {
  emptySchema,
  listUsersSchema,
  setActiveSchema,
  setRoleSchema,
  unlockLoginSchema,
  userIdSchema,
} from "@/lib/validation/users";
import { defineAction } from "./define-action";

const _listUsers = defineAction({
  schema: listUsersSchema,
  access: "ADMIN",
  handler: async (input, { user }) => users.listUsers(user!, input),
});
export async function listUsersAction(input: z.input<typeof listUsersSchema>) {
  return _listUsers(input);
}

const _setRole = defineAction({
  schema: setRoleSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await users.setRole(user!, input.userId, input.role);
    revalidatePath("/admin");
    return r;
  },
});
export async function setRoleAction(input: z.input<typeof setRoleSchema>) {
  return _setRole(input);
}

const _setActive = defineAction({
  schema: setActiveSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await users.setActive(user!, input.userId, input.isActive);
    revalidatePath("/admin");
    return r;
  },
});
export async function setActiveAction(input: z.input<typeof setActiveSchema>) {
  return _setActive(input);
}

const _createResetLink = defineAction({
  schema: userIdSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const { url, expiresAt } = await users.createResetLink(user!, input.userId);
    return { url, expiresAt: expiresAt.toISOString() };
  },
});
export async function createResetLinkAction(input: z.input<typeof userIdSchema>) {
  return _createResetLink(input);
}

const _unlockLogin = defineAction({
  schema: unlockLoginSchema,
  access: "ADMIN",
  handler: async (input, { user }) => users.unlockLogin(user!, input.email || undefined),
});
export async function unlockLoginAction(input: z.input<typeof unlockLoginSchema>) {
  return _unlockLogin(input);
}

const _getUserCounts = defineAction({
  schema: emptySchema,
  access: "ADMIN",
  handler: async (_input, { user }) => users.getUserCounts(user!),
});
export async function getUserCountsAction() {
  return _getUserCounts(undefined);
}
