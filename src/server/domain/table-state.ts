import type { MatchStatus, TableState, TableView } from "./types";

/** DISABLED > IN_PROGRESS (playing or awaiting confirmation) > RESERVED (assigned) > AVAILABLE. */
export function deriveTableState(table: TableView, activeMatch: { status: MatchStatus } | null): TableState {
  if (table.isDisabled) return "DISABLED";
  if (!activeMatch) return "AVAILABLE";
  switch (activeMatch.status) {
    case "IN_PROGRESS":
    case "AWAITING_CONFIRMATION":
      return "IN_PROGRESS";
    case "ASSIGNED":
      return "RESERVED";
    default:
      return "AVAILABLE";
  }
}
