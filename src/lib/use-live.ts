"use client";

// Polling hook for /api/live and /api/live/public.
// - polls every `intervalMs` with ?since=<revision>; "unchanged" responses keep the data
// - pauses while the tab is hidden, refetches on visibilitychange / focus / online
// - exponential backoff on errors; connection state for the offline badge
// - clockOffsetMs = serverNow − Date.now() (smoothed), for timers
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyLiveResponse,
  buildLiveUrl,
  connectionState,
  DEFAULT_INTERVAL_MS,
  nextPollDelay,
  offsetSample,
  REQUEST_TIMEOUT_MS,
  smoothOffset,
  type Connection,
} from "./live-client";
import type { LiveResponse } from "./live-types";

export type { Connection } from "./live-client";

export type UseLiveOptions<T> = {
  endpoint: string;
  /** Server-rendered snapshot, if any. */
  initial: T | null;
  intervalMs?: number;
};

export type UseLiveResult<T> = {
  data: T | null;
  connection: Connection;
  clockOffsetMs: number;
  /** Force an immediate fetch (e.g. after a successful action). */
  refresh: () => void;
  /** Client time (ms) of the last successful response. */
  lastUpdated: number | null;
};

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const getOnline = () => navigator.onLine;
const getOnlineServer = () => true;

export function useLive<T extends { revision: number; serverNow: number }>({
  endpoint,
  initial,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseLiveOptions<T>): UseLiveResult<T> {
  const [data, setData] = useState<T | null>(initial);
  const [failures, setFailures] = useState(0);
  const [clockOffsetMs, setClockOffsetMs] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const online = useSyncExternalStore(subscribeOnline, getOnline, getOnlineServer);

  const revisionRef = useRef<number | null>(initial?.revision ?? null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let consecutiveFailures = 0;

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (ms: number) => {
      clearTimer();
      if (disposed || document.hidden) return; // resumed by visibilitychange
      timer = setTimeout(() => void poll(false), ms);
    };

    const poll = async (force: boolean): Promise<void> => {
      if (disposed) return;
      if (controller) {
        if (!force) return;
        controller.abort();
      }
      clearTimer();
      const c = new AbortController();
      controller = c;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        c.abort();
      }, REQUEST_TIMEOUT_MS);
      const sentAt = Date.now();
      let ok = false;
      try {
        const res = await fetch(buildLiveUrl(endpoint, revisionRef.current), {
          cache: "no-store",
          signal: c.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as LiveResponse<T>;
        const receivedAt = Date.now();
        if (disposed || (c.signal.aborted && !timedOut)) return;
        ok = true;
        consecutiveFailures = 0;
        setFailures(0);
        setClockOffsetMs((prev) => smoothOffset(prev, offsetSample(body.serverNow, sentAt, receivedAt)));
        if (!body.unchanged) {
          revisionRef.current = body.revision;
          setData((prev) => applyLiveResponse(prev, body));
        }
        setLastUpdated(receivedAt);
      } catch {
        // Superseded by a forced refresh or unmounted: not a failure.
        if (disposed || (c.signal.aborted && !timedOut)) return;
      } finally {
        clearTimeout(timeout);
        if (controller === c) controller = null;
      }
      if (!ok) {
        consecutiveFailures += 1;
        setFailures(consecutiveFailures);
      }
      schedule(nextPollDelay(consecutiveFailures, intervalMs));
    };

    const wake = () => {
      if (!document.hidden) void poll(false);
    };
    const onVisibility = () => {
      if (document.hidden) clearTimer();
      else void poll(false);
    };

    refreshRef.current = () => void poll(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    wake();

    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      refreshRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [endpoint, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);

  return {
    data,
    connection: connectionState(failures, online),
    clockOffsetMs: clockOffsetMs ?? 0,
    refresh,
    lastUpdated,
  };
}
