// Idempotent mutations for referee submissions (result proposal / confirmation).
//
// The key row is inserted INSIDE the caller's transaction with ON CONFLICT DO
// NOTHING. The primary key makes a concurrent duplicate wait for the first
// transaction: if it commits, the duplicate sees the stored row and replays the
// response; if it rolls back, the duplicate's insert wins and it runs itself.
import { createHash } from "node:crypto";
import { db, type Db, type Tx } from "@/server/db";
import { fail } from "@/server/domain/errors";
import type { Prisma } from "@/generated/prisma/client";

export type IdempotencyOpts = {
  key: string;
  scope: string;
  userId: string;
  requestHash: string;
  /** Called when a stored response is replayed (e.g. to skip the revision bump). */
  onReplay?: () => void;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable JSON (sorted keys, undefined dropped). */
export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

/** sha256 hex of the stable JSON of a request payload. */
export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

const toJson = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/**
 * Run `fn` at most once per idempotency key. Must be called inside a transaction.
 * The returned value is the JSON round-trip of fn's result, so a first call and a
 * replay return structurally identical values.
 */
export async function runIdempotent<T>(tx: Tx, opts: IdempotencyOpts, fn: () => Promise<T>): Promise<T> {
  const key = opts.key.trim();
  if (key.length < 8 || key.length > 128) {
    fail("VALIDATION", "Ungültiger Idempotenz-Schlüssel.", { field: "idempotencyKey" });
  }
  const inserted = await tx.$executeRaw`
    INSERT INTO "IdempotencyKey" (key, "userId", scope, "requestHash", response, "createdAt")
    VALUES (${key}, ${opts.userId}, ${opts.scope}, ${opts.requestHash}, 'null'::jsonb, now())
    ON CONFLICT (key) DO NOTHING`;
  if (inserted === 0) {
    const row = await tx.idempotencyKey.findUniqueOrThrow({ where: { key } });
    if (row.userId !== opts.userId || row.scope !== opts.scope || row.requestHash !== opts.requestHash) {
      fail("IDEMPOTENCY_MISMATCH", undefined, { scope: row.scope });
    }
    opts.onReplay?.();
    return row.response as T;
  }
  const result = toJson(await fn());
  await tx.idempotencyKey.update({
    where: { key },
    data: { response: (result ?? null) as Prisma.InputJsonValue },
  });
  return result;
}

/** Delete idempotency keys older than `olderThanHours` (DB clock). Returns the number removed. */
export async function purgeIdempotencyKeys(olderThanHours = 24, client: Db = db): Promise<number> {
  const hours = Math.max(0, Math.floor(olderThanHours));
  return client.$executeRaw`
    DELETE FROM "IdempotencyKey" WHERE "createdAt" < now() - make_interval(hours => ${hours}::int)`;
}
