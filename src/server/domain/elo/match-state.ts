// Elo match lifecycle. READY (both consents valid) and PAUSED (pausedAt set) are derived
// states of DRAFT and IN_PROGRESS, as in the competitive match model.
//
//   DRAFT ──start──► IN_PROGRESS ──submit──► AWAITING_CONFIRMATION ──confirm──► COMPLETED
//     │                 │  └─staff final────────────────┐  │  └─Einspruch─► DISPUTED ─┤
//     └─cancel/expire   └─abandon (staff) ─► CANCELLED  └──┴──► COMPLETED ◄──resolve─┘
//   AWAITING/DISPUTED ─void (staff)─► VOIDED;  COMPLETED ─void (admin)─► VOIDED
import { fail } from "../errors";
import { ELO_LIVE_STATUSES, ELO_OPEN_STATUSES, type EloMatchStatus } from "./types";

type Edge = readonly [EloMatchStatus, EloMatchStatus];

const EDGES: readonly Edge[] = [
  ["DRAFT", "IN_PROGRESS"],
  ["DRAFT", "CANCELLED"],
  ["IN_PROGRESS", "AWAITING_CONFIRMATION"],
  ["IN_PROGRESS", "COMPLETED"], // staff final result
  ["IN_PROGRESS", "CANCELLED"], // staff abandons a running match
  ["AWAITING_CONFIRMATION", "COMPLETED"],
  ["AWAITING_CONFIRMATION", "DISPUTED"],
  ["AWAITING_CONFIRMATION", "VOIDED"],
  ["DISPUTED", "COMPLETED"],
  ["DISPUTED", "VOIDED"],
  ["COMPLETED", "VOIDED"],
];

export function canEloTransition(from: EloMatchStatus, to: EloMatchStatus): boolean {
  return EDGES.some(([f, t]) => f === from && t === to);
}

export function assertEloTransition(from: EloMatchStatus, to: EloMatchStatus): void {
  if (!canEloTransition(from, to)) {
    fail("INVALID_TRANSITION", `Matchstatus kann nicht von ${from} nach ${to} wechseln.`, { from, to });
  }
}

/** Holds its table and its players. */
export const isEloLive = (s: EloMatchStatus): boolean => ELO_LIVE_STATUSES.includes(s);
/** Still needs a decision: blocks a mode switch and closing the session. */
export const isEloOpen = (s: EloMatchStatus): boolean => ELO_OPEN_STATUSES.includes(s);
