import { fail } from "./errors";
import { ACTIVE_MATCH_STATUSES, DECIDED_MATCH_STATUSES, type MatchStatus } from "./types";

type Edge = readonly [MatchStatus, MatchStatus];

const NORMAL_EDGES: readonly Edge[] = [
  ["PENDING", "READY"],
  ["READY", "ASSIGNED"],
  ["ASSIGNED", "READY"], // unassign
  ["ASSIGNED", "IN_PROGRESS"],
  ["IN_PROGRESS", "AWAITING_CONFIRMATION"], // result proposal
  ["AWAITING_CONFIRMATION", "IN_PROGRESS"], // proposal rejected
  ["AWAITING_CONFIRMATION", "COMPLETED"],
  ["READY", "FORFEITED"],
  ["ASSIGNED", "FORFEITED"],
  ["IN_PROGRESS", "FORFEITED"],
  ["AWAITING_CONFIRMATION", "FORFEITED"],
  ["PENDING", "CANCELLED"],
  ["READY", "CANCELLED"],
  ["ASSIGNED", "CANCELLED"],
  ["IN_PROGRESS", "CANCELLED"],
  ["AWAITING_CONFIRMATION", "CANCELLED"],
];

/** Recovery only: reopening decided matches and voiding downstream matches. */
const RECOVERY_EDGES: readonly Edge[] = [
  ["COMPLETED", "READY"],
  ["FORFEITED", "READY"],
  ["COMPLETED", "PENDING"],
  ["FORFEITED", "PENDING"],
  ["READY", "PENDING"],
  ["ASSIGNED", "PENDING"],
  ["IN_PROGRESS", "PENDING"],
  ["AWAITING_CONFIRMATION", "PENDING"],
  ["ASSIGNED", "READY"],
  ["IN_PROGRESS", "READY"],
  ["AWAITING_CONFIRMATION", "READY"],
];

const hasEdge = (edges: readonly Edge[], from: MatchStatus, to: MatchStatus) =>
  edges.some(([f, t]) => f === from && t === to);

export function canMatchTransition(
  from: MatchStatus,
  to: MatchStatus,
  opts?: { recovery?: boolean },
): boolean {
  if (hasEdge(NORMAL_EDGES, from, to)) return true;
  return opts?.recovery === true && hasEdge(RECOVERY_EDGES, from, to);
}

export function assertMatchTransition(
  from: MatchStatus,
  to: MatchStatus,
  opts?: { recovery?: boolean },
): void {
  if (!canMatchTransition(from, to, opts)) {
    fail("INVALID_TRANSITION", `Spielstatus kann nicht von ${from} nach ${to} wechseln.`, {
      from,
      to,
      recovery: opts?.recovery === true,
    });
  }
}

export function isActiveStatus(s: MatchStatus): boolean {
  return ACTIVE_MATCH_STATUSES.includes(s);
}

export function isDecidedStatus(s: MatchStatus): boolean {
  return DECIDED_MATCH_STATUSES.includes(s);
}
