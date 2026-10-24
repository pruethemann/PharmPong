import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { createTeam, getMyTeam, joinTeam } from "@/server/services/teams";
import { removeTeamLogo, uploadTeamLogo } from "@/server/services/team-logo";
import { getStorage } from "@/server/storage";
import { clearMemoryStorage, memoryStorageKeys } from "@/server/storage/memory";
import { GET } from "@/app/api/logos/[teamId]/route";
import { makeTournament, makeUser } from "./factories";

type U = Awaited<ReturnType<typeof makeUser>>;
const actor = (u: U): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: false,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
  return "RESOLVED";
}

async function png(color = "#22d3ee", size = 64): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function get(teamId: string, v?: number) {
  const url = `http://localhost/api/logos/${teamId}${v === undefined ? "" : `?v=${v}`}`;
  return GET(new Request(url), { params: Promise.resolve({ teamId }) });
}

async function setup() {
  const t = await makeTournament({ status: "REGISTRATION_OPEN" });
  const [a, b, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  const { teamId, inviteCode } = await createTeam(actor(a), { name: "Logo Lab" }, { tournamentId: t.id });
  await joinTeam(actor(b), inviteCode, { tournamentId: t.id });
  return { t, a, b, outsider, teamId };
}

beforeEach(() => clearMemoryStorage());

describe("team logo upload", () => {
  it("uses the memory driver in tests", () => {
    expect(process.env.STORAGE_DRIVER).toBe("memory");
    expect(getStorage()).toBeDefined();
  });

  it("rejects SVG text, GIF bytes and files over 1 MB", async () => {
    const { a, teamId } = await setup();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(await png());
    expect(await code(uploadTeamLogo(actor(a), teamId, svg))).toBe("UPLOAD_INVALID");
    expect(await code(uploadTeamLogo(actor(a), teamId, gif))).toBe("UPLOAD_INVALID");
    expect(await code(uploadTeamLogo(actor(a), teamId, big))).toBe("UPLOAD_INVALID");
    // A PNG signature followed by garbage fails decoding → also UPLOAD_INVALID.
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    expect(await code(uploadTeamLogo(actor(a), teamId, fake))).toBe("UPLOAD_INVALID");
    expect(memoryStorageKeys()).toEqual([]);
  });

  it("stores a 256×256 WebP, bumps logoVersion and deletes the previous object", async () => {
    const { a, b, teamId } = await setup();
    const first = await uploadTeamLogo(actor(a), teamId, await png("#ff0000", 400));
    expect(first.logoVersion).toBe(1);
    expect(first.logoUrl).toBe(`/api/logos/${teamId}?v=1`);
    const keys1 = memoryStorageKeys();
    expect(keys1).toHaveLength(1);
    expect(keys1[0]).toMatch(new RegExp(`^logos/${teamId}/[0-9a-f]+\\.webp$`));
    const stored = await getStorage().get(keys1[0]);
    expect(stored?.contentType).toBe("image/webp");
    const meta = await sharp(Buffer.from(stored!.bytes)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();

    const second = await uploadTeamLogo(actor(b), teamId, await png("#00ff00"));
    expect(second.logoVersion).toBe(2);
    const keys2 = memoryStorageKeys();
    expect(keys2).toHaveLength(1);
    expect(keys2[0]).not.toBe(keys1[0]);
    expect((await getMyTeam(a.id))?.logoUrl).toBe(`/api/logos/${teamId}?v=2`);
    expect(await db.auditLog.count({ where: { entityId: teamId, action: "team.logo_upload" } })).toBe(2);

    const removed = await removeTeamLogo(actor(a), teamId);
    expect(removed).toEqual({ logoUrl: null, logoVersion: 3 });
    expect(memoryStorageKeys()).toEqual([]);
  });

  it("rejects uploads by non-members (FORBIDDEN) but allows admins", async () => {
    const { outsider, teamId } = await setup();
    expect(await code(uploadTeamLogo(actor(outsider), teamId, await png()))).toBe("FORBIDDEN");
    expect(await code(removeTeamLogo(actor(outsider), teamId))).toBe("FORBIDDEN");
    const admin = await makeUser({ role: "ADMIN" });
    const r = await uploadTeamLogo(actor(admin), teamId, await png());
    expect(r.logoVersion).toBe(1);
  });
});

describe("GET /api/logos/[teamId]", () => {
  it("returns 404 without a logo", async () => {
    const { teamId } = await setup();
    const res = await get(teamId, 0);
    expect(res.status).toBe(404);
    expect((await get("does-not-exist")).status).toBe(404);
  });

  it("serves the WebP with immutable caching only for the current version", async () => {
    const { a, teamId } = await setup();
    await uploadTeamLogo(actor(a), teamId, await png());
    const res = await get(teamId, 1);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...body.slice(8, 12))).toBe("WEBP");
    const stale = await get(teamId, 0);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
