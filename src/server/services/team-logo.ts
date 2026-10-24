// Team logo upload/removal. Bytes are sniffed (PNG/JPEG/WebP only), re-encoded by
// sharp to a 256×256 WebP and stored in object storage under a fresh random key.
// The DB pointer (logoKey + logoVersion) changes inside a tournament transaction;
// the previous object is deleted after commit (best effort).
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { fail } from "@/server/domain/errors";
import { assertRole, isAdmin } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { getStorage } from "@/server/storage";
import { LOGO_CONTENT_TYPE, LOGO_MAX_BYTES, normalizeLogo, sniffImageType } from "@/server/storage/image";
import { writeAudit } from "./audit";
import { canEditProfile, canManageTeam, teamLogoUrl } from "./teams";
import { withTournamentTx } from "./tx";

export type LogoResult = { logoUrl: string | null; logoVersion: number };

async function loadTeam(teamId: string) {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, tournamentId: true, status: true },
  });
  if (!team) fail("NOT_FOUND", "Team nicht gefunden.");
  return team;
}

async function deleteQuietly(key: string | null | undefined) {
  if (!key) return;
  try {
    await getStorage().delete(key);
  } catch (e) {
    console.warn("[team-logo] could not delete object", key, e);
  }
}

/** Validate an upload without touching storage. Throws UPLOAD_INVALID. */
export async function prepareLogo(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) fail("UPLOAD_INVALID");
  if (!sniffImageType(bytes)) fail("UPLOAD_INVALID");
  try {
    return await normalizeLogo(bytes);
  } catch {
    fail("UPLOAD_INVALID");
  }
}

export async function uploadTeamLogo(actor: Actor, teamId: string, bytes: Uint8Array): Promise<LogoResult> {
  assertRole(actor, "PLAYER");
  const team = await loadTeam(teamId);
  if (!(await canManageTeam(actor, teamId))) fail("FORBIDDEN");
  const webp = await prepareLogo(bytes);

  const key = `logos/${team.id}/${randomBytes(12).toString("hex")}.webp`;
  await getStorage().put(key, webp, LOGO_CONTENT_TYPE);

  let previousKey: string | null = null;
  try {
    const result = await withTournamentTx(team.tournamentId, async (tx, ctx) => {
      if (!canEditProfile(ctx.tournament.status)) fail("INVALID_STATE", "Das Turnier ist bereits beendet.");
      // Re-check membership under the lock (the user may have left meanwhile).
      if (!(await canManageTeam(actor, teamId, tx))) fail("FORBIDDEN");
      const current = await tx.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { status: true, logoKey: true, logoVersion: true },
      });
      if (current.status !== "ACTIVE") fail("INVALID_STATE", "Dieses Team ist aufgelöst.");
      previousKey = current.logoKey;
      const updated = await tx.team.update({
        where: { id: teamId },
        data: { logoKey: key, logoVersion: { increment: 1 }, version: { increment: 1 } },
        select: { id: true, logoKey: true, logoVersion: true },
      });
      await writeAudit(tx, {
        tournamentId: team.tournamentId,
        actorId: actor.id,
        action: isAdmin(actor) ? "admin.team.logo_upload" : "team.logo_upload",
        entityType: "Team",
        entityId: teamId,
        before: { logoKey: current.logoKey },
        after: { logoKey: key, bytes: webp.byteLength },
      });
      return { logoUrl: teamLogoUrl(updated), logoVersion: updated.logoVersion };
    });
    await deleteQuietly(previousKey);
    return result;
  } catch (e) {
    await deleteQuietly(key); // nothing references the new object
    throw e;
  }
}

export async function removeTeamLogo(actor: Actor, teamId: string): Promise<LogoResult> {
  assertRole(actor, "PLAYER");
  const team = await loadTeam(teamId);
  if (!(await canManageTeam(actor, teamId))) fail("FORBIDDEN");
  let previousKey: string | null = null;
  const result = await withTournamentTx(team.tournamentId, async (tx, ctx) => {
    if (!canEditProfile(ctx.tournament.status)) fail("INVALID_STATE", "Das Turnier ist bereits beendet.");
    if (!(await canManageTeam(actor, teamId, tx))) fail("FORBIDDEN");
    const current = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { logoKey: true, logoVersion: true },
    });
    if (!current.logoKey) {
      ctx.dirty = false;
      return { logoUrl: null, logoVersion: current.logoVersion };
    }
    previousKey = current.logoKey;
    const updated = await tx.team.update({
      where: { id: teamId },
      data: { logoKey: null, logoVersion: { increment: 1 }, version: { increment: 1 } },
      select: { logoVersion: true },
    });
    await writeAudit(tx, {
      tournamentId: team.tournamentId,
      actorId: actor.id,
      action: isAdmin(actor) ? "admin.team.logo_remove" : "team.logo_remove",
      entityType: "Team",
      entityId: teamId,
      before: { logoKey: current.logoKey },
    });
    return { logoUrl: null, logoVersion: updated.logoVersion };
  });
  await deleteQuietly(previousKey);
  return result;
}

/** Public read for the logo route. */
export async function getTeamLogo(
  teamId: string,
): Promise<{ bytes: Uint8Array; contentType: string; logoVersion: number } | null> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { logoKey: true, logoVersion: true },
  });
  if (!team?.logoKey) return null;
  const obj = await getStorage().get(team.logoKey);
  if (!obj) return null;
  return { bytes: obj.bytes, contentType: obj.contentType, logoVersion: team.logoVersion };
}
