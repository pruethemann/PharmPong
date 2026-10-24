import { afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";

let tables: string[] | undefined;

export async function truncateAll() {
  if (!tables) {
    const rows = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    tables = rows.map((r) => `"${r.tablename}"`);
  }
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await db.$disconnect();
});
