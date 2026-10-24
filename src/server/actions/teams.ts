"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail } from "@/server/domain/errors";
import { LOGO_MAX_BYTES } from "@/server/storage/image";
import { getCurrentTournamentId } from "@/server/services/tx";
import * as teams from "@/server/services/teams";
import * as logo from "@/server/services/team-logo";
import {
  adminCreateTeamSchema,
  adminDissolveTeamSchema,
  adminMemberSchema,
  adminRenameTeamSchema,
  adminReplaceMemberSchema,
  adminSetMottoSchema,
  createTeamSchema,
  joinTeamSchema,
  setReadySchema,
  teamIdSchema,
  updateTeamSchema,
} from "@/lib/validation/team";
import { defineAction } from "./define-action";

function refresh() {
  revalidatePath("/team");
  revalidatePath("/admin");
  revalidatePath("/tournament");
}

// ─── Player ────────────────────────────────────────────────────────────────

const _createTeam = defineAction({
  schema: createTeamSchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    const r = await teams.createTeam(user!, input);
    refresh();
    return r;
  },
});
export async function createTeamAction(input: z.input<typeof createTeamSchema>) {
  return _createTeam(input);
}

const _joinTeam = defineAction({
  schema: joinTeamSchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    const r = await teams.joinTeam(user!, input.code);
    refresh();
    return { teamId: r.teamId };
  },
});
export async function joinTeamAction(input: z.input<typeof joinTeamSchema>) {
  return _joinTeam(input);
}

const _leaveTeam = defineAction({
  schema: z.object({}),
  access: "PLAYER",
  handler: async (_input, { user }) => {
    const r = await teams.leaveTeam(user!);
    refresh();
    return r;
  },
});
export async function leaveTeamAction() {
  return _leaveTeam({});
}

const _rotateInvite = defineAction({
  schema: z.object({}),
  access: "PLAYER",
  handler: async (_input, { user }) => {
    const r = await teams.rotateInviteCode(user!);
    revalidatePath("/team");
    return { inviteCode: r.inviteCode };
  },
});
export async function rotateInviteCodeAction() {
  return _rotateInvite({});
}

const _updateTeam = defineAction({
  schema: updateTeamSchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    const r = await teams.updateTeam(user!, input);
    refresh();
    return r;
  },
});
export async function updateTeamAction(input: z.input<typeof updateTeamSchema>) {
  return _updateTeam(input);
}

const _setReady = defineAction({
  schema: setReadySchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    await teams.setReady(user!, input.ready);
    refresh();
    return { ready: input.ready };
  },
});
export async function setReadyAction(input: z.input<typeof setReadySchema>) {
  return _setReady(input);
}

// ─── Logo ──────────────────────────────────────────────────────────────────

const logoUploadSchema = z.object({
  teamId: z.string().min(1).max(64),
  file: z.instanceof(File, { message: "Bitte wähle ein Bild aus." }),
});

const _uploadLogo = defineAction({
  schema: logoUploadSchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    // Reject before buffering; the service re-checks size and content.
    if (input.file.size > LOGO_MAX_BYTES) fail("UPLOAD_INVALID");
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const r = await logo.uploadTeamLogo(user!, input.teamId, bytes);
    refresh();
    return r;
  },
});
/** FormData fields: teamId, file. */
export async function uploadTeamLogoAction(formData: FormData) {
  return _uploadLogo({ teamId: formData.get("teamId"), file: formData.get("file") } as z.input<
    typeof logoUploadSchema
  >);
}

const _removeLogo = defineAction({
  schema: teamIdSchema,
  access: "PLAYER",
  handler: async (input, { user }) => {
    const r = await logo.removeTeamLogo(user!, input.teamId);
    refresh();
    return r;
  },
});
export async function removeTeamLogoAction(input: z.input<typeof teamIdSchema>) {
  return _removeLogo(input);
}

// ─── Admin repair ──────────────────────────────────────────────────────────

const _adminRename = defineAction({
  schema: adminRenameTeamSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    await teams.adminRenameTeam(user!, input);
    refresh();
  },
});
export async function adminRenameTeamAction(input: z.input<typeof adminRenameTeamSchema>) {
  return _adminRename(input);
}

const _adminMotto = defineAction({
  schema: adminSetMottoSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    await teams.adminSetMotto(user!, input);
    refresh();
  },
});
export async function adminSetMottoAction(input: z.input<typeof adminSetMottoSchema>) {
  return _adminMotto(input);
}

const _adminRemoveMember = defineAction({
  schema: adminMemberSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await teams.adminRemoveMember(user!, input);
    refresh();
    return r;
  },
});
export async function adminRemoveMemberAction(input: z.input<typeof adminMemberSchema>) {
  return _adminRemoveMember(input);
}

const _adminAddMember = defineAction({
  schema: adminMemberSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await teams.adminAddMember(user!, input);
    refresh();
    return r;
  },
});
export async function adminAddMemberAction(input: z.input<typeof adminMemberSchema>) {
  return _adminAddMember(input);
}

const _adminReplaceMember = defineAction({
  schema: adminReplaceMemberSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    await teams.adminReplaceMember(user!, input);
    refresh();
  },
});
export async function adminReplaceMemberAction(input: z.input<typeof adminReplaceMemberSchema>) {
  return _adminReplaceMember(input);
}

const _adminDissolve = defineAction({
  schema: adminDissolveTeamSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    await teams.adminDissolveTeam(user!, input);
    refresh();
  },
});
export async function adminDissolveTeamAction(input: z.input<typeof adminDissolveTeamSchema>) {
  return _adminDissolve(input);
}

const _adminCreate = defineAction({
  schema: adminCreateTeamSchema,
  access: "ADMIN",
  handler: async (input, { user }) => {
    const r = await teams.adminCreateTeam(user!, input);
    refresh();
    return { teamId: r.teamId };
  },
});
export async function adminCreateTeamAction(input: z.input<typeof adminCreateTeamSchema>) {
  return _adminCreate(input);
}

const _adminList = defineAction({
  schema: z.object({}),
  access: "ADMIN",
  handler: async (_input, { user }) => {
    const id = await getCurrentTournamentId();
    return id ? teams.listTeamsAdmin(user!, id) : [];
  },
});
export async function listTeamsAdminAction() {
  return _adminList({});
}
