import { createMemoryStorage } from "./memory";
import { createS3Storage } from "./s3";
import type { ObjectStorage } from "./types";

export type { ObjectStorage, StoredObject } from "./types";

type Env = Record<string, string | undefined>;

const cache = globalThis as unknown as { __ppStorage?: { signature: string; storage: ObjectStorage } };

function truthy(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

/**
 * Build a storage driver from environment variables (STORAGE_DRIVER=memory|s3).
 *
 * The memory driver keeps objects in this process only (lost on restart, not
 * shared between replicas), so it is refused when NODE_ENV=production unless
 * ALLOW_MEMORY_STORAGE=true is set explicitly (local `next start` smoke tests).
 * An unset STORAGE_DRIVER in production is a configuration error, not "memory".
 */
export function createStorageFromEnv(e: Env = process.env): ObjectStorage {
  const production = e.NODE_ENV === "production";
  const driver = (e.STORAGE_DRIVER || (production ? "" : "memory")).toLowerCase();
  if (!driver) {
    throw new Error("STORAGE_DRIVER must be set in production (use STORAGE_DRIVER=s3 with a durable bucket)");
  }
  if (driver === "memory") {
    if (production && !truthy(e.ALLOW_MEMORY_STORAGE)) {
      throw new Error(
        "STORAGE_DRIVER=memory is not allowed in production: logos would be lost on restart. " +
          "Use STORAGE_DRIVER=s3 (or set ALLOW_MEMORY_STORAGE=true for a throwaway local run).",
      );
    }
    return createMemoryStorage();
  }
  if (driver === "s3") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !e[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 requires ${missing.join(", ")}`);
    return createS3Storage({
      endpoint: e.S3_ENDPOINT || undefined,
      region: e.S3_REGION || "auto",
      bucket: e.S3_BUCKET!,
      accessKeyId: e.S3_ACCESS_KEY_ID!,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: truthy(e.S3_FORCE_PATH_STYLE),
    });
  }
  throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
}

/** Process-wide storage driver, rebuilt if the relevant env vars change (tests). */
export function getStorage(): ObjectStorage {
  const e = process.env;
  const signature = [
    e.NODE_ENV,
    e.STORAGE_DRIVER,
    e.ALLOW_MEMORY_STORAGE,
    e.S3_ENDPOINT,
    e.S3_BUCKET,
    e.S3_REGION,
  ].join("|");
  if (cache.__ppStorage?.signature !== signature) {
    cache.__ppStorage = { signature, storage: createStorageFromEnv(e) };
  }
  return cache.__ppStorage.storage;
}
