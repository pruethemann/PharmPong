"use client";

import { createContext, useContext } from "react";
import type { AuthedSnapshot, LiveTable } from "@/lib/live-types";
import type { RunFn } from "./use-match-action";

export type ClosedMatch = {
  matchId: string;
  /**
   * "me": our confirm returned ok. "other": someone else confirmed (STALE_VERSION / observed).
   * "unknown": the snapshot shows it confirmed while our own confirm had no definitive answer
   * (response lost): it may have been ours, so nobody is credited.
   */
  by: "me" | "other" | "unknown";
  advancedTo: string | null;
  champion: boolean;
};

export type RefereeCtx = {
  snap: AuthedSnapshot;
  table: LiveTable;
  clockOffsetMs: number;
  /** Connection is online: critical writes are allowed. */
  online: boolean;
  pending: string | null;
  run: RunFn;
  /**
   * True after a write ended without a definitive answer (network loss) until a fresh
   * snapshot shows whether it happened: no retry before the referee has seen the real state.
   */
  unverified: boolean;
  /** True while the snapshot has not yet caught up with our last successful write. */
  syncing: (matchId: string) => boolean;
  /** Remember the version returned by a successful write. */
  expectVersion: (matchId: string, version: number) => void;
  closeMatch: (c: ClosedMatch) => void;
  dismissClosed: () => void;
  selectTable: (id: string) => void;
};

const Ctx = createContext<RefereeCtx | null>(null);

export const RefereeProvider = Ctx.Provider;

export function useReferee(): RefereeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReferee outside RefereeProvider");
  return v;
}
