import type { ObjectStorage, StoredObject } from "./types";

// Module-level map on globalThis so dev hot reloads and tests share one store.
const globalStore = globalThis as unknown as { __ppMemoryStorage?: Map<string, StoredObject> };

function store(): Map<string, StoredObject> {
  globalStore.__ppMemoryStorage ??= new Map();
  return globalStore.__ppMemoryStorage;
}

/** In-process storage for development and tests. Not durable. */
export function createMemoryStorage(): ObjectStorage {
  return {
    async put(key, bytes, contentType) {
      store().set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async get(key) {
      const obj = store().get(key);
      return obj ? { bytes: new Uint8Array(obj.bytes), contentType: obj.contentType } : null;
    },
    async delete(key) {
      store().delete(key);
    },
  };
}

/** Test helpers. */
export function memoryStorageKeys(): string[] {
  return [...store().keys()];
}

export function clearMemoryStorage(): void {
  store().clear();
}
