// Who may do what with an Elo match. One source of truth: services call assertEloAction
// (authoritative, with specific German errors); the live snapshot sends eloMatchActions as UI hints.
//
// Principles:
//   - A player acts only for the side they play on; their participant row decides, never the input.
//   - Staff powers (REFEREE/ADMIN) never apply to a match the staff member plays in, admins
//     included, so nobody can decide a result for both teams.
//   - Admins may correct or void completed matches (audited, with a reason).
import { DomainError } from "../errors";
import type { EloMatchStatus, EloResultPolicy, EloRole, Side } from "./types";

export type EloViewer = { userId: string; role: EloRole };

export type EloMatchFacts = {
  status: EloMatchStatus;
  createdById: string;
  resultPolicy: EloResultPolicy;
  participants: readonly { userId: string; side: Side }[];
  /** Each side's consent matches the current roster. */
  consentA: boolean;
  consentB: boolean;
  paused: boolean;
  /** Side that submitted the pending result (AWAITING_CONFIRMATION only). */
  submittedSide: Side | null;
  /** A DRAFT whose reservation ran out; the next write cancels it. */
  expired: boolean;
};

export const ELO_MATCH_ACTIONS = [
  "editRoster",
  "consent",
  "staffConsent",
  "leave",
  "cancel",
  "start",
  "pause",
  "resume",
  "submitResult",
  "amendResult",
  "confirmResult",
  "disputeResult",
  "staffFinalize",
  "voidResult",
  "abandon",
  "correct",
  "voidCompleted",
] as const;

export type EloMatchAction = (typeof ELO_MATCH_ACTIONS)[number];
export type EloActionFlags = Record<EloMatchAction, boolean>;

/** Statuses in which an action is possible at all. */
const ACTION_STATUSES: Record<EloMatchAction, readonly EloMatchStatus[]> = {
  editRoster: ["DRAFT"],
  consent: ["DRAFT"],
  staffConsent: ["DRAFT"],
  leave: ["DRAFT"],
  cancel: ["DRAFT"],
  start: ["DRAFT"],
  pause: ["IN_PROGRESS"],
  resume: ["IN_PROGRESS"],
  submitResult: ["IN_PROGRESS"],
  amendResult: ["AWAITING_CONFIRMATION"],
  confirmResult: ["AWAITING_CONFIRMATION"],
  disputeResult: ["AWAITING_CONFIRMATION"],
  staffFinalize: ["IN_PROGRESS", "AWAITING_CONFIRMATION", "DISPUTED"],
  voidResult: ["AWAITING_CONFIRMATION", "DISPUTED"],
  abandon: ["IN_PROGRESS"],
  correct: ["COMPLETED"],
  voidCompleted: ["COMPLETED"],
};

const forbidden = (message: string) => new DomainError("FORBIDDEN", message);
const invalidState = (message: string, details?: Record<string, unknown>) =>
  new DomainError("INVALID_STATE", message, details);

const OWN_MATCH = "In einem Match, in dem du mitspielst, kannst du nicht als Schiri entscheiden.";
const STAFF_ONLY = "Das kann nur die Schiri oder die Turnierleitung entscheiden.";

/** null when the viewer may perform the action, else the specific error to throw. */
export function eloActionDenial(
  action: EloMatchAction,
  m: EloMatchFacts,
  viewer: EloViewer | null,
): DomainError | null {
  if (!viewer) return new DomainError("UNAUTHENTICATED");
  if (!ACTION_STATUSES[action].includes(m.status)) {
    return invalidState("Das ist in diesem Matchstatus nicht möglich.", { status: m.status, action });
  }
  if (m.status === "DRAFT" && m.expired) {
    return invalidState("Der Entwurf ist abgelaufen. Bitte ein neues Match erstellen.");
  }
  const side = m.participants.find((p) => p.userId === viewer.userId)?.side ?? null;
  const isStaff = viewer.role === "REFEREE" || viewer.role === "ADMIN";
  const staffActive = isStaff && side === null;
  const isCreator = viewer.userId === m.createdById;
  const staffDenial = () => forbidden(isStaff ? OWN_MATCH : STAFF_ONLY);

  switch (action) {
    case "editRoster":
      return isCreator || staffActive
        ? null
        : forbidden("Nur wer das Match erstellt hat oder die Schiri kann die Aufstellung ändern.");
    case "consent":
      if (!side) return forbidden("Nur Mitspielende können die Aufstellung für ihr Team bestätigen.");
      return (side === "A" ? m.consentA : m.consentB)
        ? invalidState("Dein Team hat die Aufstellung bereits bestätigt.")
        : null;
    case "staffConsent":
      if (!staffActive) return staffDenial();
      return m.consentA && m.consentB
        ? invalidState("Beide Teams haben die Aufstellung bereits bestätigt.")
        : null;
    case "leave":
      return side ? null : forbidden("Du spielst in diesem Match nicht mit.");
    case "cancel":
      return isCreator || staffActive
        ? null
        : forbidden("Nur wer das Match erstellt hat oder die Schiri kann es abbrechen.");
    case "start":
      if (!side && !staffActive)
        return forbidden("Nur Mitspielende oder die Schiri können das Match starten.");
      return m.consentA && m.consentB
        ? null
        : invalidState("Beide Teams müssen die Aufstellung zuerst bestätigen.");
    case "pause":
    case "resume":
      if (!side && !staffActive)
        return forbidden("Nur Mitspielende oder die Schiri können die Uhr bedienen.");
      if (action === "pause" && m.paused) return invalidState("Die Uhr ist bereits pausiert.");
      if (action === "resume" && !m.paused) return invalidState("Die Uhr läuft bereits.");
      return null;
    case "submitResult":
      if (side) return null;
      return forbidden(
        staffActive
          ? "Als Schiri bitte «Resultat festlegen» verwenden."
          : "Nur Mitspielende können ein Resultat melden.",
      );
    case "amendResult":
      if (!side) return forbidden("Nur Mitspielende können ein Resultat melden.");
      return side === m.submittedSide ? null : forbidden("Nur das meldende Team kann seine Meldung ändern.");
    case "confirmResult":
      if (m.resultPolicy === "REFEREE_ONLY")
        return forbidden("Bei dieser Regel bestätigt die Schiri das Resultat.");
      if (!side) return forbidden("Nur das gegnerische Team kann das Resultat bestätigen.");
      return side !== m.submittedSide
        ? null
        : forbidden("Das andere Team muss bestätigen: Dein Team hat das Resultat gemeldet.");
    case "disputeResult":
      if (!side) return forbidden("Nur das gegnerische Team kann Einspruch erheben.");
      return side !== m.submittedSide
        ? null
        : forbidden("Dein Team hat das Resultat gemeldet: Ändere die Meldung, statt Einspruch zu erheben.");
    case "staffFinalize":
    case "voidResult":
    case "abandon":
      return staffActive ? null : staffDenial();
    case "correct":
    case "voidCompleted":
      return viewer.role === "ADMIN"
        ? null
        : forbidden("Nur die Turnierleitung kann abgeschlossene Matches korrigieren.");
  }
}

/** Throws the specific DomainError unless the viewer may perform the action. */
export function assertEloAction(
  action: EloMatchAction,
  m: EloMatchFacts,
  viewer: EloViewer | null,
): asserts viewer is EloViewer {
  const denial = eloActionDenial(action, m, viewer);
  if (denial) throw denial;
}

/** All actions the viewer may perform now (UI hints; the server re-checks every request). */
export function eloMatchActions(m: EloMatchFacts, viewer: EloViewer | null): EloActionFlags {
  return Object.fromEntries(
    ELO_MATCH_ACTIONS.map((a) => [a, eloActionDenial(a, m, viewer) === null]),
  ) as EloActionFlags;
}
