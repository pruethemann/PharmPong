// German copy for Elo Mode that is shared across screens.
import type { RatingTier } from "@/server/domain/elo/repeat";
import type {
  EloEndTypeKey,
  EloMatchStatusKey,
  EloResultPolicyKey,
  EloSessionStatusKey,
  EloSideKey,
} from "@/lib/elo-live-types";

export const eloMatchStatusLabel: Record<EloMatchStatusKey, string> = {
  DRAFT: "Aufstellung",
  IN_PROGRESS: "Läuft",
  AWAITING_CONFIRMATION: "Resultat offen",
  DISPUTED: "Einspruch",
  COMPLETED: "Beendet",
  CANCELLED: "Abgebrochen",
  VOIDED: "Annulliert",
};

export const eloEndTypeLabel: Record<EloEndTypeKey, string> = {
  REGULAR: "Alle Becher getroffen",
  CONCEDED: "Aufgegeben",
};

export const eloSessionStatusLabel: Record<EloSessionStatusKey, string> = {
  OPEN: "Läuft",
  PAUSED: "Pausiert",
  CLOSED: "Beendet",
};

export const eloResultPolicyLabel: Record<EloResultPolicyKey, string> = {
  DUAL_TEAM_CONFIRMATION: "Beide Teams bestätigen",
  REFEREE_ONLY: "Nur die Schiri bestätigt",
};

export const sideLabel: Record<EloSideKey, string> = { A: "Team A", B: "Team B" };

export const ratingTierLabel: Record<RatingTier, string> = {
  FULL: "Voll gewertet",
  PARTIAL: "Halb gewertet",
  UNRATED: "Nicht gewertet",
};

/** Timeline entries of an Elo match (EloMatchEvent.type). */
export const eloEventLabel: Record<string, string> = {
  CREATED: "Match erstellt",
  ROSTER_CHANGED: "Aufstellung geändert",
  CONSENTED: "Aufstellung bestätigt",
  CONSENTED_BY_STAFF: "Zustimmung vor Ort (Schiri)",
  LEFT: "Ausgestiegen",
  CANCELLED: "Abgebrochen",
  EXPIRED: "Reservation abgelaufen",
  STARTED: "Angepfiffen",
  PAUSED: "Pausiert",
  RESUMED: "Fortgesetzt",
  RESULT_SUBMITTED: "Resultat eingetragen",
  RESULT_AMENDED: "Resultat korrigiert",
  RESULT_CONFIRMED: "Resultat bestätigt",
  DISPUTED: "Einspruch",
  VOIDED: "Annulliert",
  ABANDONED: "Abgebrochen (Schiri)",
  CORRECTED: "Korrigiert (Turnierleitung)",
};
