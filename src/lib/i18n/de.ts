// All user-facing German copy that is shared across screens.
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
