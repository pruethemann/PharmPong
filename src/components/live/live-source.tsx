"use client";

import type { ReactNode } from "react";
import type { Connection } from "@/lib/use-live";
import { useLive } from "@/lib/use-live";
import { liveEndpoint, type LiveMode } from "./live-view";

export type LiveRender<T> = (live: {
  data: T;
  /** null for a static (non-polling) render. */
  connection: Connection | null;
  clockOffsetMs: number;
  refresh: () => void;
}) => ReactNode;

function Polling<T extends { revision: number; serverNow: number }>({
  endpoint,
  initial,
  children,
}: {
  endpoint: string;
  initial: T;
  children: LiveRender<T>;
}) {
  const { data, connection, clockOffsetMs, refresh } = useLive<T>({ endpoint, initial });
  return <>{children({ data: data ?? initial, connection, clockOffsetMs, refresh })}</>;
}

/** Polls the live endpoint for `mode`, or renders the initial snapshot once (static). */
export function LiveSource<T extends { revision: number; serverNow: number }>({
  mode,
  initial,
  children,
}: {
  mode: LiveMode;
  initial: T;
  children: LiveRender<T>;
}) {
  if (mode === "static") {
    return <>{children({ data: initial, connection: null, clockOffsetMs: 0, refresh: () => {} })}</>;
  }
  return (
    <Polling endpoint={liveEndpoint[mode]} initial={initial}>
      {children}
    </Polling>
  );
}
