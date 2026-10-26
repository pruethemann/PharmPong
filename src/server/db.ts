import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Not marked "server-only" so that scripts/ and integration tests can import it.

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaClass?: typeof PrismaClient;
};

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString, max: 10 });
  return new PrismaClient({ adapter });
}

// In development the client survives hot reloads on globalThis. After `prisma generate` (schema change)
// the generated class is new: replace the cached client, or it keeps validating against the old schema.
const cached = globalForPrisma.prismaClass === PrismaClient ? globalForPrisma.prisma : undefined;
if (globalForPrisma.prisma && !cached) void globalForPrisma.prisma.$disconnect().catch(() => {});

export const db: PrismaClient = cached ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaClass = PrismaClient;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
