import { db, type Db } from "@/server/db";

export type ThrottleRule = { limit: number; windowSec: number; lockSec: number };

export const RULES = {
  loginEmail: { limit: 5, windowSec: 15 * 60, lockSec: 15 * 60 },
  loginIp: { limit: 100, windowSec: 15 * 60, lockSec: 15 * 60 }, // venue NAT: keep loose
  register: { limit: 20, windowSec: 60 * 60, lockSec: 30 * 60 },
  join: { limit: 10, windowSec: 15 * 60, lockSec: 15 * 60 },
  reset: { limit: 10, windowSec: 15 * 60, lockSec: 15 * 60 },
} satisfies Record<string, ThrottleRule>;

/** Returns the lock expiry if the key is currently locked, else null. Does not count. */
export async function isLocked(key: string, client: Db = db): Promise<Date | null> {
  const row = await client.authThrottle.findUnique({ where: { key } });
  if (row?.lockedUntil && row.lockedUntil > new Date()) return row.lockedUntil;
  return null;
}

/** Atomically count one attempt; returns whether the key is now locked. */
export async function hit(
  key: string,
  rule: ThrottleRule,
  client: Db = db,
): Promise<{ locked: boolean; count: number }> {
  const window = `${rule.windowSec} seconds`;
  const lock = `${rule.lockSec} seconds`;
  const rows = await client.$queryRaw<{ count: number; lockedUntil: Date | null }[]>`
    INSERT INTO "AuthThrottle" (key, count, "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "AuthThrottle"."windowStart" < now() - ${window}::interval THEN 1 ELSE "AuthThrottle".count + 1 END,
      "windowStart" = CASE WHEN "AuthThrottle"."windowStart" < now() - ${window}::interval THEN now() ELSE "AuthThrottle"."windowStart" END,
      "lockedUntil" = CASE
        WHEN (CASE WHEN "AuthThrottle"."windowStart" < now() - ${window}::interval THEN 1 ELSE "AuthThrottle".count + 1 END) >= ${rule.limit}
        THEN now() + ${lock}::interval
        ELSE "AuthThrottle"."lockedUntil" END
    RETURNING count, "lockedUntil"`;
  const row = rows[0];
  return { count: row.count, locked: !!row.lockedUntil && row.lockedUntil > new Date() };
}

export async function clear(key: string, client: Db = db): Promise<void> {
  await client.authThrottle.deleteMany({ where: { key } });
}

export async function clearAll(client: Db = db): Promise<number> {
  const r = await client.authThrottle.deleteMany({});
  return r.count;
}
