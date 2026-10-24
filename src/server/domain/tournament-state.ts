import { fail } from "./errors";
import type { TournamentStatus } from "./types";

type Edge = readonly [TournamentStatus, TournamentStatus];

const NORMAL_EDGES: readonly Edge[] = [
  ["DRAFT", "REGISTRATION_OPEN"],
  ["REGISTRATION_OPEN", "REGISTRATION_LOCKED"],
  // Reopen registration; the caller ensures no draw exists yet.
  ["REGISTRATION_LOCKED", "REGISTRATION_OPEN"],
  ["REGISTRATION_LOCKED", "GROUP_STAGE"],
  ["GROUP_STAGE", "KNOCKOUT_STAGE"],
  ["KNOCKOUT_STAGE", "COMPLETED"],
  ["DRAFT", "CANCELLED"],
  ["REGISTRATION_OPEN", "CANCELLED"],
  ["REGISTRATION_LOCKED", "CANCELLED"],
  ["GROUP_STAGE", "CANCELLED"],
  ["KNOCKOUT_STAGE", "CANCELLED"],
];

/** Admin recovery after a correction invalidated later phases. */
const RECOVERY_EDGES: readonly Edge[] = [
  ["COMPLETED", "KNOCKOUT_STAGE"],
  ["KNOCKOUT_STAGE", "GROUP_STAGE"],
];

const hasEdge = (edges: readonly Edge[], from: TournamentStatus, to: TournamentStatus) =>
  edges.some(([f, t]) => f === from && t === to);

export function canTransition(
  from: TournamentStatus,
  to: TournamentStatus,
  opts?: { recovery?: boolean },
): boolean {
  if (hasEdge(NORMAL_EDGES, from, to)) return true;
  return opts?.recovery === true && hasEdge(RECOVERY_EDGES, from, to);
}

export function assertTransition(
  from: TournamentStatus,
  to: TournamentStatus,
  opts?: { recovery?: boolean },
): void {
  if (!canTransition(from, to, opts)) {
    fail("INVALID_TRANSITION", `Statuswechsel von ${from} nach ${to} ist nicht erlaubt.`, {
      from,
      to,
      recovery: opts?.recovery === true,
    });
  }
}

export function isRegistrationOpen(status: TournamentStatus): boolean {
  return status === "REGISTRATION_OPEN";
}

/** Rosters are frozen from REGISTRATION_LOCKED onward (incl. COMPLETED/CANCELLED). */
export function isRosterLocked(status: TournamentStatus): boolean {
  return status !== "DRAFT" && status !== "REGISTRATION_OPEN";
}

export function isPlayPhase(status: TournamentStatus): boolean {
  return status === "GROUP_STAGE" || status === "KNOCKOUT_STAGE";
}
