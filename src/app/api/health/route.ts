import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return Response.json(
      {
        ok: true,
        db: "ok",
        latencyMs: Date.now() - startedAt,
        commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, db: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
