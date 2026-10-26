// All user-facing German copy that is shared across screens.
import type { ErrorCode } from "@/server/domain/errors";

export type MatchStatusKey =
  | "PENDING"
  | "READY"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_CONFIRMATION"
  | "COMPLETED"
  | "CANCELLED"
  | "FORFEITED";

export type TournamentStatusKey =
  | "DRAFT"
  | "REGISTRATION_OPEN"
  | "REGISTRATION_LOCKED"
  | "GROUP_STAGE"
  | "KNOCKOUT_STAGE"
  | "COMPLETED"
  | "CANCELLED";

export type EndTypeKey = "REGULAR" | "TIME_LIMIT" | "SHOOTOUT" | "FORFEIT";
export type TableStateKey = "AVAILABLE" | "RESERVED" | "IN_PROGRESS" | "DISABLED";
export type RoleKey = "PLAYER" | "REFEREE" | "ADMIN";

export const matchStatusLabel: Record<MatchStatusKey, string> = {
  PENDING: "Offen",
  READY: "Bereit",
  ASSIGNED: "Tisch zugewiesen",
  IN_PROGRESS: "Läuft",
  AWAITING_CONFIRMATION: "Wartet auf Bestätigung",
  COMPLETED: "Beendet",
  CANCELLED: "Abgesagt",
  FORFEITED: "Forfait",
};

export const tournamentStatusLabel: Record<TournamentStatusKey, string> = {
  DRAFT: "In Vorbereitung",
  REGISTRATION_OPEN: "Anmeldung offen",
  REGISTRATION_LOCKED: "Anmeldung geschlossen",
  GROUP_STAGE: "Gruppenphase",
  KNOCKOUT_STAGE: "K.-o.-Phase",
  COMPLETED: "Turnier beendet",
  CANCELLED: "Abgesagt",
};

export const endTypeLabel: Record<EndTypeKey, string> = {
  REGULAR: "Alle Becher getroffen",
  TIME_LIMIT: "Zeitablauf",
  SHOOTOUT: "Shootout",
  FORFEIT: "Forfait",
};

export const tableStateLabel: Record<TableStateKey, string> = {
  AVAILABLE: "Frei",
  RESERVED: "Reserviert",
  IN_PROGRESS: "Spiel läuft",
  DISABLED: "Gesperrt",
};

export const roleLabel: Record<RoleKey, string> = {
  PLAYER: "Spieler:in",
  REFEREE: "Schiedsrichter:in",
  ADMIN: "Admin",
};

export const knockoutRoundLabel: Record<number, string> = {
  1: "Viertelfinal",
  2: "Halbfinal",
  3: "Final",
};

export const errorMessage: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Bitte melde dich zuerst an.",
  FORBIDDEN: "Dafür fehlen dir die Berechtigungen.",
  VALIDATION: "Bitte überprüfe deine Eingaben.",
  NOT_FOUND: "Nicht gefunden.",
  STALE_VERSION:
    "Jemand anderes hat das gerade geändert. Die Ansicht wurde aktualisiert. Bitte prüfe und versuche es erneut.",
  INVALID_STATE: "Diese Aktion ist im aktuellen Zustand nicht möglich.",
  INVALID_TRANSITION: "Dieser Statuswechsel ist nicht erlaubt.",
  TOURNAMENT_PAUSED: "Das Turnier ist pausiert.",
  TEAM_BUSY: "Eines der Teams spielt gerade an einem anderen Tisch.",
  TABLE_BUSY: "An diesem Tisch läuft bereits ein Spiel.",
  TABLE_DISABLED: "Dieser Tisch ist gesperrt.",
  TEAM_FULL: "Dieses Team ist bereits vollständig.",
  ALREADY_IN_TEAM: "Du bist bereits in einem Team.",
  NOT_IN_TEAM: "Du bist in keinem Team.",
  ROSTER_LOCKED: "Die Teams sind gesperrt. Änderungen nur noch durch die Turnierleitung.",
  INVALID_INVITE: "Dieser Einladungscode ist ungültig.",
  NAME_TAKEN: "Dieser Teamname ist schon vergeben.",
  EMAIL_TAKEN: "Mit dieser E-Mail-Adresse existiert bereits ein Konto.",
  INVALID_CREDENTIALS: "E-Mail oder Passwort ist falsch.",
  RATE_LIMITED: "Zu viele Versuche. Bitte warte ein paar Minuten.",
  WRONG_TEAM_COUNT: "Für die Auslosung braucht es genau 12 vollständige Teams.",
  GROUPS_INCOMPLETE: "Es sind noch nicht alle Gruppenspiele bestätigt.",
  UNRESOLVED_TIE: "Ein Gleichstand in der Gruppe muss zuerst per Shootout entschieden werden.",
  INVALID_RESULT: "Dieses Resultat ist nicht gültig.",
  DOWNSTREAM_STARTED:
    "Folgespiele haben bereits begonnen. Die Korrektur ist nur über den Wiederherstellungs-Assistenten möglich.",
  IDEMPOTENCY_MISMATCH: "Diese Anfrage wurde bereits mit anderen Daten gesendet.",
  CONFIRMATION_REQUIRED: "Bitte bestätige die Aktion mit dem verlangten Text.",
  UPLOAD_INVALID: "Bitte lade ein PNG-, JPEG- oder WebP-Bild bis 1 MB hoch.",
  WRONG_MODE: "Das geht im aktuellen Spielmodus nicht.",
  PLAYER_BUSY: "Jemand aus der Aufstellung spielt gerade ein anderes Match.",
  SESSION_NOT_OPEN: "Die Elo-Runde nimmt gerade keine neuen Matches an.",
  MODE_SWITCH_BLOCKED: "Der Spielmodus kann erst gewechselt werden, wenn alle offenen Matches erledigt sind.",
  ROSTER_CHANGED: "Die Aufstellung wurde inzwischen geändert. Bitte prüfe sie und bestätige erneut.",
  INTERNAL: "Unerwarteter Fehler. Bitte versuche es erneut.",
};
