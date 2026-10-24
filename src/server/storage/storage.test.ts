import { describe, expect, it } from "vitest";
import { createStorageFromEnv, getStorage } from "./index";
import { clearMemoryStorage, createMemoryStorage, memoryStorageKeys } from "./memory";

describe("memory storage", () => {
  it("puts, gets (copy) and deletes idempotently", async () => {
    clearMemoryStorage();
    const s = createMemoryStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put("logos/t/a.webp", bytes, "image/webp");
    bytes[0] = 9; // stored copy is not affected
    expect(await s.get("logos/t/a.webp")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
    });
    expect(memoryStorageKeys()).toEqual(["logos/t/a.webp"]);
    // Shared across instances (module-level map on globalThis).
    expect(await createMemoryStorage().get("logos/t/a.webp")).not.toBeNull();
    await s.delete("logos/t/a.webp");
    await s.delete("logos/t/a.webp");
    expect(await s.get("logos/t/a.webp")).toBeNull();
  });
});

describe("storage factory", () => {
  it("defaults to memory and validates s3 configuration", () => {
    expect(createStorageFromEnv({})).toBeDefined();
    expect(() => createStorageFromEnv({ STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(() => createStorageFromEnv({ STORAGE_DRIVER: "ftp" })).toThrow(/Unknown/);
    expect(
      createStorageFromEnv({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
        S3_ENDPOINT: "http://localhost:9000",
        S3_FORCE_PATH_STYLE: "true",
      }),
    ).toBeDefined();
  });

  it("refuses the memory driver (explicit or by default) in production", () => {
    expect(() => createStorageFromEnv({ NODE_ENV: "production" })).toThrow(/STORAGE_DRIVER must be set/);
    expect(() => createStorageFromEnv({ NODE_ENV: "production", STORAGE_DRIVER: "memory" })).toThrow(
      /not allowed in production/,
    );
    expect(() => createStorageFromEnv({ NODE_ENV: "production", STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(
      createStorageFromEnv({
        NODE_ENV: "production",
        STORAGE_DRIVER: "memory",
        ALLOW_MEMORY_STORAGE: "true",
      }),
    ).toBeDefined();
    expect(createStorageFromEnv({ NODE_ENV: "development" })).toBeDefined();
    expect(createStorageFromEnv({ NODE_ENV: "test", STORAGE_DRIVER: "memory" })).toBeDefined();
  });

  it("getStorage caches the driver per configuration", () => {
    expect(getStorage()).toBe(getStorage());
  });
});
