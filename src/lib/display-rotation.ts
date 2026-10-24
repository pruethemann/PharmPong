// Rotation of the secondary panel on /display. Pure, no React/DOM.
//
// The two table panels are never part of the rotation: only the secondary panel
// cycles. Rotation freezes while the tournament is paused.
import type { TournamentStatusKey } from "./i18n/de";

export const DISPLAY_ROTATION_MS = 15_000;

export type DisplayPanel = "groups" | "bracket" | "upNext" | "teams";

export const displayPanelLabel: Record<DisplayPanel, string> = {
  groups: "Gruppen-Tabellen",
  bracket: "K.-o.-Tableau",
  upNext: "Als Nächstes",
  teams: "Angemeldete Teams",
};

export type PanelInput = {
  status: TournamentStatusKey;
  groupCount: number;
  knockoutMatchCount: number;
  upNextCount: number;
  teamCount: number;
};

/** Panels worth showing in this phase, most relevant first. */
export function displayPanels(input: PanelInput): DisplayPanel[] {
  const groups = input.groupCount > 0;
  const bracket = input.knockoutMatchCount > 0;
  const upNext = input.upNextCount > 0;
  let order: [DisplayPanel, boolean][];
  switch (input.status) {
    case "GROUP_STAGE":
      order = [
        ["groups", groups],
        ["upNext", upNext],
        ["bracket", bracket],
      ];
      break;
    case "KNOCKOUT_STAGE":
      order = [
        ["bracket", bracket],
        ["upNext", upNext],
        ["groups", groups],
      ];
      break;
    case "COMPLETED":
      order = [
        ["bracket", bracket],
        ["groups", groups],
      ];
      break;
    default:
      // Before the draw: show who is in, plus anything that already exists.
      order = [
        ["teams", input.teamCount > 0],
        ["groups", groups],
        ["upNext", upNext],
      ];
  }
  const panels = order.filter(([, ok]) => ok).map(([p]) => p);
  return panels.length > 0 ? panels : ["teams"];
}

export type RotationState = { panel: DisplayPanel; since: number };

/** The panel after `current` (wraps); the first panel if `current` is no longer available. */
export function nextPanel(current: DisplayPanel | null, panels: readonly DisplayPanel[]): DisplayPanel {
  if (panels.length === 0) return "teams";
  const i = current ? panels.indexOf(current) : -1;
  return i === -1 ? panels[0] : panels[(i + 1) % panels.length];
}

export function initRotation(panels: readonly DisplayPanel[], now: number): RotationState {
  return { panel: panels[0] ?? "teams", since: now };
}

/**
 * One tick of the rotation clock. Returns the same object when nothing changes.
 * - panel disappeared (phase change): jump to the first available panel immediately
 * - paused: keep the panel, restart its time slice so it does not flip right after resuming
 * - otherwise advance after `intervalMs`
 */
export function advanceRotation(
  state: RotationState,
  now: number,
  panels: readonly DisplayPanel[],
  opts: { paused: boolean; intervalMs?: number },
): RotationState {
  const intervalMs = opts.intervalMs ?? DISPLAY_ROTATION_MS;
  if (!panels.includes(state.panel)) return { panel: nextPanel(null, panels), since: now };
  if (opts.paused) return state.since === now ? state : { panel: state.panel, since: now };
  if (panels.length < 2) return state;
  if (now - state.since < intervalMs) return state;
  return { panel: nextPanel(state.panel, panels), since: now };
}

/** 0..1 progress of the current time slice (for a progress bar). */
export function rotationProgress(
  state: RotationState,
  now: number,
  intervalMs = DISPLAY_ROTATION_MS,
): number {
  return Math.min(1, Math.max(0, (now - state.since) / intervalMs));
}
