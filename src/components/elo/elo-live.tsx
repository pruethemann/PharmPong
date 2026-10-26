"use client";

// Elo live data for every Elo screen: one poller per page (/api/elo/live, or the public endpoint for
// guests while sharing is on), shared through context so the arena, the builder, the match page and
// the leaderboard always show the same revision.
import { createContext, useContext, type ReactNode } from "react";
import { useLive, type Connection } from "@/lib/use-live";
import type { EloAuthedExtras, EloPublicSnapshot } from "@/lib/elo-live-types";

export type EloLiveMode = "authed" | "public" | "static";

/** The public snapshot, plus the personal extras when signed in. */
export type EloSnapshot = EloPublicSnapshot & Partial<EloAuthedExtras>;

export type EloLiveValue = {
  data: EloSnapshot;
  /** null for a static (non-polling) render. */
  connection: Connection | null;
  clockOffsetMs: number;
  refresh: () => void;
  mode: EloLiveMode;
};

const EloLiveContext = createContext<EloLiveValue | null>(null);

export function useEloLive(): EloLiveValue {
  const v = useContext(EloLiveContext);
  if (!v) throw new Error("useEloLive outside of <EloLiveProvider>");
  return v;
}

const ENDPOINT = { authed: "/api/elo/live", public: "/api/elo/live/public" } as const;

function Polling({
  mode,
  initial,
  children,
}: {
  mode: "authed" | "public";
  initial: EloSnapshot;
  children: ReactNode;
}) {
  const { data, connection, clockOffsetMs, refresh } = useLive<EloSnapshot>({
    endpoint: ENDPOINT[mode],
    initial,
  });
  return (
    <EloLiveContext.Provider value={{ data: data ?? initial, connection, clockOffsetMs, refresh, mode }}>
      {children}
    </EloLiveContext.Provider>
  );
}

export function EloLiveProvider({
  mode,
  initial,
  children,
}: {
  mode: EloLiveMode;
  initial: EloSnapshot;
  children: ReactNode;
}) {
  if (mode === "static") {
    return (
      <EloLiveContext.Provider
        value={{ data: initial, connection: null, clockOffsetMs: 0, refresh: () => {}, mode }}
      >
        {children}
      </EloLiveContext.Provider>
    );
  }
  return (
    <Polling mode={mode} initial={initial}>
      {children}
    </Polling>
  );
}
