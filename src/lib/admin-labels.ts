// German labels and formatting for the admin interface. Pure, usable on client and server.

/** Known audit actions → German label. Unknown actions fall back to the raw key. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Matches
  "match.assign": "Spiel zugewiesen",
  "match.unassign": "Zuweisung aufgehoben",
  "match.start": "Spiel gestartet",
  "match.propose": "Resultat erfasst",
  "match.reject": "Resultat zurückgewiesen",
  "match.confirm": "Resultat bestätigt",
  "match.correct": "Resultat korrigiert",
  "match.forfeit": "Forfait erfasst",
  "match.abort": "Spiel abgebrochen",
  "match.void": "Spiel zurückgesetzt",
  "match.reseed": "K.-o.-Paarung neu gesetzt",
  "match.cancel_all": "Alle Spiele abgesagt",
  "match.issue_report": "Problem gemeldet",
  "match.issue_resolve": "Problem gelöst",
  // Tournament
  "tournament.update_settings": "Einstellungen geändert",
  "tournament.open_registration": "Anmeldung geöffnet",
  "tournament.lock_registration": "Anmeldung gesperrt",
  "tournament.reopen_registration": "Anmeldung wieder geöffnet",
  "tournament.draw": "Gruppen ausgelost",
  "tournament.redraw": "Gruppen neu ausgelost",
  "tournament.reset_draw": "Auslosung zurückgesetzt",
  "tournament.start_group_stage": "Gruppenphase gestartet",
  "tournament.start_knockout": "K.-o.-Phase gestartet",
  "tournament.seed_quarterfinals": "Viertelfinals gesetzt",
  "tournament.pause": "Turnier pausiert",
  "tournament.resume": "Turnier fortgesetzt",
  "tournament.complete": "Turnier beendet",
  "tournament.champion_change": "Turniersieger geändert",
  "tournament.recovery": "Wiederherstellung ausgeführt",
  "tournament.cancel": "Turnier abgebrochen",
  "tournament.public_display": "Öffentliche Anzeige umgeschaltet",
  // Game mode and Elo Mode
  "game.mode": "Spielmodus gewechselt",
  "elo.session.open": "Elo-Runde eröffnet",
  "elo.session.pause": "Elo-Runde pausiert",
  "elo.session.resume": "Elo-Runde fortgesetzt",
  "elo.session.close": "Elo-Runde beendet",
  "elo.session.reopen": "Elo-Runde wieder geöffnet",
  "elo.session.settings": "Elo-Einstellungen geändert",
  "elo.params": "Elo-Parameter geändert",
  "elo.recalculate": "Elo neu berechnet",
  "elo.drafts.cancel": "Elo-Aufstellungen abgebrochen",
  "elo.match.roster": "Elo-Aufstellung geändert (Schiri)",
  "elo.match.staff_consent": "Elo-Zustimmung vor Ort erfasst",
  "elo.match.cancel": "Elo-Match abgebrochen",
  "elo.match.abandon": "Laufendes Elo-Match abgebrochen",
  "elo.match.dispute": "Elo-Einspruch erhoben",
  "elo.match.staff_final": "Elo-Resultat von Schiri festgelegt",
  "elo.match.resolve": "Elo-Einspruch entschieden",
  "elo.match.void_pending": "Offenes Elo-Resultat annulliert",
  "elo.match.correct": "Elo-Match korrigiert",
  "elo.match.void": "Elo-Match annulliert",
  // Tables
  "table.rename": "Tisch umbenannt",
  "table.disable": "Tisch gesperrt",
  "table.enable": "Tisch freigegeben",
  // Tiebreaks
  "tiebreak.record": "Ranking-Shootout erfasst",
  "tiebreak.void": "Ranking-Shootout aufgehoben",
  // Teams (players)
  "team.create": "Team gegründet",
  "team.join": "Team beigetreten",
  "team.leave": "Team verlassen",
  "team.leave_dissolve": "Team verlassen (aufgelöst)",
  "team.update": "Team bearbeitet",
  "team.ready": "Bereit gemeldet",
  "team.unready": "Bereitschaft zurückgezogen",
  "team.rotate_invite": "Einladungscode erneuert",
  "team.logo_upload": "Logo hochgeladen",
  "team.logo_remove": "Logo entfernt",
  // Teams (admin)
  "admin.team.create": "Team erstellt (Admin)",
  "admin.team.rename": "Team umbenannt (Admin)",
  "admin.team.motto": "Motto geändert (Admin)",
  "admin.team.add_member": "Mitglied hinzugefügt (Admin)",
  "admin.team.remove_member": "Mitglied entfernt (Admin)",
  "admin.team.replace_member": "Mitglied ersetzt (Admin)",
  "admin.team.dissolve": "Team aufgelöst (Admin)",
  "admin.team.logo_upload": "Logo hochgeladen (Admin)",
  "admin.team.logo_remove": "Logo entfernt (Admin)",
  // Users & auth
  "user.register": "Konto registriert",
  "user.admin_create": "Admin per Kommandozeile angelegt",
  "user.profile_update": "Profil geändert",
  "user.password_change": "Passwort geändert",
  "user.reset_link": "Reset-Link erstellt",
  "user.reset_redeem": "Passwort per Reset-Link gesetzt",
  "user.role_change": "Rolle geändert",
  "user.activate": "Konto aktiviert",
  "user.deactivate": "Konto deaktiviert",
  "auth.unlock": "Login-Sperre aufgehoben",
  "demo.seed": "Demodaten erstellt",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Filter chips for the audit log (action prefix). */
export const AUDIT_ACTION_PREFIXES: readonly { value: string; label: string }[] = [
  { value: "match.", label: "Spiele" },
  { value: "tournament.", label: "Turnier" },
  { value: "elo.", label: "Elo-Modus" },
  { value: "game.", label: "Spielmodus" },
  { value: "tiebreak.", label: "Shootouts" },
  { value: "table.", label: "Tische" },
  { value: "admin.team.", label: "Teams (Admin)" },
  { value: "team.", label: "Teams" },
  { value: "user.", label: "Benutzer" },
  { value: "auth.", label: "Login" },
];

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  Match: "Spiel",
  Team: "Team",
  User: "Benutzer",
  Tournament: "Turnier",
  GameTable: "Tisch",
  GroupTiebreak: "Ranking-Shootout",
  AuthThrottle: "Login-Sperre",
  EloMatch: "Elo-Match",
  EloSession: "Elo-Runde",
};

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type;
}

/** Match timeline events → German label. */
export const MATCH_EVENT_LABELS: Record<string, string> = {
  ASSIGNED: "Tisch zugewiesen",
  UNASSIGNED: "Zuweisung aufgehoben",
  STARTED: "Gestartet",
  PAUSED: "Pausiert",
  RESUMED: "Fortgesetzt",
  PROPOSED: "Resultat erfasst",
  REJECTED: "Resultat zurückgewiesen",
  CONFIRMED: "Resultat bestätigt",
  CORRECTED: "Resultat korrigiert",
  VOIDED: "Zurückgesetzt",
  FORFEITED: "Forfait",
  ABORTED: "Abgebrochen",
  ADVANCED: "Team weitergekommen",
  CHAMPION: "Turniersieg",
  ISSUE_REPORTED: "Problem gemeldet",
  ISSUE_RESOLVED: "Problem gelöst",
};

export function matchEventLabel(type: string): string {
  return MATCH_EVENT_LABELS[type] ?? type;
}

const ZURICH = "Europe/Zurich";
const dateTimeFmt = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZURICH,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZURICH,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const shortFmt = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZURICH,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Format a UTC timestamp for display in Europe/Zurich. */
export function formatZurich(
  value: Date | number | string | null | undefined,
  style: "datetime" | "time" | "short" = "datetime",
): string {
  if (value == null) return "–";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "–";
  const fmt = style === "time" ? timeFmt : style === "short" ? shortFmt : dateTimeFmt;
  return fmt.format(d);
}

/** "vor 3 Min." style relative label for small differences; falls back to the time. */
export function relativeFromNow(ms: number | null, nowMs: number): string {
  if (ms == null) return "–";
  const diff = Math.max(0, nowMs - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 10) return "gerade eben";
  if (sec < 60) return `vor ${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min.`;
  return formatZurich(ms, "time");
}
