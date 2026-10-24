// Pure helpers behind useLive (no React, no DOM), unit-tested in live-client.test.ts.
import type { LiveResponse } from "./live-types";

export type Connection = "online" | "reconnecting" | "offline";

export const DEFAULT_INTERVAL_MS = 2500;
export const BACKOFF_BASE_MS = 2500;
export const BACKOFF_MAX_MS = 15_000;
export const OFFLINE_AFTER_FAILURES = 3;
export const REQUEST_TIMEOUT_MS = 10_000;

/** Delay before the next poll: the normal interval, or 2.5 s → 5 s → 10 s → 15 s (max) after failures. */
export function nextPollDelay(
  consecutiveFailures: number,
  intervalMs = DEFAULT_INTERVAL_MS,
  baseMs = BACKOFF_BASE_MS,
  maxMs = BACKOFF_MAX_MS,
): number {
  if (consecutiveFailures <= 0) return intervalMs;
  const exp = Math.min(consecutiveFailures - 1, 16);
  return Math.min(maxMs, baseMs * 2 ** exp);
}

/** reconnecting after one failure, offline after ≥ 3 consecutive failures or when the browser is offline. */
export function connectionState(consecutiveFailures: number, browserOnline: boolean): Connection {
  if (!browserOnline || consecutiveFailures >= OFFLINE_AFTER_FAILURES) return "offline";
  if (consecutiveFailures >= 1) return "reconnecting";
  return "online";
}

/** Server-minus-client clock offset for one round trip, assuming the server stamped mid-flight. */
export function offsetSample(serverNow: number, sentAt: number, receivedAt: number): number {
  return Math.round(serverNow - (sentAt + receivedAt) / 2);
}

/**
 * Exponential smoothing of the clock offset. The first sample is taken as is;
 * jumps larger than `jumpMs` (device clock changed, sleep) reset the estimate.
 */
export function smoothOffset(prev: number | null, sample: number, alpha = 0.25, jumpMs = 2000): number {
  if (prev === null || !Number.isFinite(prev) || Math.abs(sample - prev) > jumpMs) return sample;
  return Math.round(prev + alpha * (sample - prev));
}

/** endpoint + since=<rev>, preserving existing query parameters. */
export function buildLiveUrl(endpoint: string, since: number | null): string {
  if (since === null) return endpoint;
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${sep}since=${encodeURIComponent(String(since))}`;
}

/** Next data after a response: unchanged keeps the current data, otherwise the snapshot (without the flag). */
export function applyLiveResponse<T extends { revision: number }>(
  current: T | null,
  res: LiveResponse<T>,
): T | null {
  if (res.unchanged) return current;
  const { unchanged: _unchanged, ...snapshot } = res;
  return snapshot as unknown as T;
}

/** Parse the `since` query parameter; anything but a non-negative integer → null. */
export function parseSince(raw: string | null): number | null {
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
