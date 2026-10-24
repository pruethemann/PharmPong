// Idempotency keys for critical admin submissions (e.g. confirming a result).
// One key per (matchId, step, resultRevision), kept in sessionStorage so a retry
// after a refresh or a network loss reuses the same key and cannot double-submit.

export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function idempotencyStorageKey(matchId: string, step: string, resultRevision: number): string {
  return `pp:idem:${step}:${matchId}:${resultRevision}`;
}

function safeStorage(): KeyStorage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function getOrCreateIdempotencyKey(
  matchId: string,
  step: string,
  resultRevision: number,
  storage: KeyStorage | null = safeStorage(),
  generate: () => string = () => crypto.randomUUID(),
): string {
  const k = idempotencyStorageKey(matchId, step, resultRevision);
  try {
    const existing = storage?.getItem(k);
    if (existing) return existing;
  } catch {
    // storage unavailable: fall through to a fresh key
  }
  const key = generate();
  try {
    storage?.setItem(k, key);
  } catch {
    // ignore quota / privacy mode errors
  }
  return key;
}

export function clearIdempotencyKey(
  matchId: string,
  step: string,
  resultRevision: number,
  storage: KeyStorage | null = safeStorage(),
): void {
  try {
    storage?.removeItem(idempotencyStorageKey(matchId, step, resultRevision));
  } catch {
    // ignore
  }
}
