// Physical table state in Elo Mode. Drafts reserve a table only until they expire; expired
// drafts are cancelled lazily by the next Elo write and already shown as free.
import type { TableState } from "../types";
import type { EloMatchStatus } from "./types";

export function isDraftExpired(expiresAtMs: number | null, nowMs: number): boolean {
  return expiresAtMs !== null && expiresAtMs <= nowMs;
}

/** DISABLED > IN_PROGRESS (running) > RESERVED (unexpired draft) > AVAILABLE. */
export function deriveEloTableState(
  table: { isDisabled: boolean },
  live: { status: EloMatchStatus; expiresAt: number | null } | null,
  nowMs: number,
): TableState {
  if (table.isDisabled) return "DISABLED";
  if (!live) return "AVAILABLE";
  if (live.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (live.status === "DRAFT" && !isDraftExpired(live.expiresAt, nowMs)) return "RESERVED";
  return "AVAILABLE";
}
