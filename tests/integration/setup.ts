import { afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";

let tables: string[] | undefined;

export async function truncateAll() {
  if (!tables) {
    const rows = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    tables = rows.map((r) => `"${r.tablename}"`);
  }
  if (!tables.length) return;
  // TRUNCATE has a fixed cost per table, so only the tables a test actually wrote to are emptied
  // (an empty table has no rows to remove and no advanced sequence to restart).
  const probe = tables.map((t) => `SELECT '${t}' AS t WHERE EXISTS (SELECT 1 FROM ${t})`).join(" UNION ALL ");
  const dirty = (await db.$queryRawUnsafe<{ t: string }[]>(probe)).map((r) => r.t);
  if (dirty.length) await db.$executeRawUnsafe(`TRUNCATE ${dirty.join(", ")} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await db.$disconnect();
});
