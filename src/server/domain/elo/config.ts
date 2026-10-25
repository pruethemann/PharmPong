// PharmaElo configuration: spec defaults and server-side validation of session settings
// and rating parameters. Rating parameters live on calculation runs (see replay.ts);
// session settings never change existing ratings.
import { fail } from "../errors";
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE, type EloParams, type EloResultPolicy } from "./types";

export const ELO_ALGORITHM_VERSION = "pharmaelo-v1";

/** Spec §9.1 defaults, verbatim. The last multiplier applies to the 4th and all later meetings. */
export const DEFAULT_ELO_CONFIG = {
  initialRating: 100,
  kFactor: 24,
  ratingScale: 100,
  minTeamSize: 1,
  maxTeamSize: 4,
  minGamesForChampion: 3,
  hardTimeLimit: null,
  softTimeReminderMinutes: 20,
  resultConfirmation: "DUAL_TEAM_CONFIRMATION",
  repeatMatchMultipliers: [1, 1, 0.5, 0],
} as const;

export const DEFAULT_ELO_PARAMS: EloParams = {
  initialRating: DEFAULT_ELO_CONFIG.initialRating,
  kFactor: DEFAULT_ELO_CONFIG.kFactor,
  ratingScale: DEFAULT_ELO_CONFIG.ratingScale,
  repeatMultipliers: DEFAULT_ELO_CONFIG.repeatMatchMultipliers,
};

/** Settings that only affect future matches and the leaderboard presentation. */
export type EloSessionSettings = {
  minTeamSize: number;
  maxTeamSize: number;
  minGamesForChampion: number;
  /** Minutes after which a running match shows a non-blocking reminder; null = off. */
  softReminderMinutes: number | null;
  resultPolicy: EloResultPolicy;
};

export const DEFAULT_SESSION_SETTINGS: EloSessionSettings = {
  minTeamSize: DEFAULT_ELO_CONFIG.minTeamSize,
  maxTeamSize: DEFAULT_ELO_CONFIG.maxTeamSize,
  minGamesForChampion: DEFAULT_ELO_CONFIG.minGamesForChampion,
  softReminderMinutes: DEFAULT_ELO_CONFIG.softTimeReminderMinutes,
  resultPolicy: DEFAULT_ELO_CONFIG.resultConfirmation,
};

/** Unstarted drafts hold their table and players this long after the last roster activity. */
export const DRAFT_TTL_MINUTES = 10;

export const ELO_LIMITS = {
  initialRating: { min: 0, max: 10_000 },
  kFactor: { max: 100 }, // and > 0
  ratingScale: { min: 10, max: 1000 },
  repeatMultipliers: { minLength: 1, maxLength: 10 },
  minGamesForChampion: { min: 0, max: 100 },
  softReminderMinutes: { min: 1, max: 240 },
} as const;

const RESULT_POLICIES: readonly EloResultPolicy[] = ["DUAL_TEAM_CONFIRMATION", "REFEREE_ONLY"];

function invalid(field: string, message: string): never {
  fail("VALIDATION", message, { field });
}

const isIntIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
const isIn = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

/** Throws VALIDATION (with `details.field`) unless the rating parameters are usable. */
export function validateEloParams(p: EloParams): EloParams {
  const L = ELO_LIMITS;
  if (!isIn(p.initialRating, L.initialRating.min, L.initialRating.max)) {
    invalid("initialRating", "Die Startwertung muss zwischen 0 und 10000 liegen.");
  }
  if (!(Number.isFinite(p.kFactor) && p.kFactor > 0 && p.kFactor <= L.kFactor.max)) {
    invalid("kFactor", "Der K-Faktor muss grösser als 0 und höchstens 100 sein.");
  }
  if (!isIn(p.ratingScale, L.ratingScale.min, L.ratingScale.max)) {
    invalid("ratingScale", "Die Skala D muss zwischen 10 und 1000 liegen.");
  }
  const m = p.repeatMultipliers;
  if (
    !Array.isArray(m) ||
    m.length < L.repeatMultipliers.minLength ||
    m.length > L.repeatMultipliers.maxLength ||
    !m.every((x) => isIn(x, 0, 1))
  ) {
    invalid("repeatMultipliers", "Es braucht 1 bis 10 Wiederholungs-Faktoren, jeder zwischen 0 und 1.");
  }
  return p;
}

/** Throws VALIDATION (with `details.field`) unless the session settings are usable. */
export function validateSessionSettings(s: EloSessionSettings): EloSessionSettings {
  const L = ELO_LIMITS;
  if (!isIntIn(s.minTeamSize, MIN_TEAM_SIZE, MAX_TEAM_SIZE)) {
    invalid("minTeamSize", "Die minimale Teamgrösse muss zwischen 1 und 4 liegen.");
  }
  if (!isIntIn(s.maxTeamSize, s.minTeamSize, MAX_TEAM_SIZE)) {
    invalid("maxTeamSize", "Die maximale Teamgrösse muss zwischen der minimalen und 4 liegen.");
  }
  if (!isIntIn(s.minGamesForChampion, L.minGamesForChampion.min, L.minGamesForChampion.max)) {
    invalid("minGamesForChampion", "Die Mindestanzahl Spiele muss zwischen 0 und 100 liegen.");
  }
  if (
    s.softReminderMinutes !== null &&
    !isIntIn(s.softReminderMinutes, L.softReminderMinutes.min, L.softReminderMinutes.max)
  ) {
    invalid("softReminderMinutes", "Die Erinnerung muss zwischen 1 und 240 Minuten liegen oder aus sein.");
  }
  if (!RESULT_POLICIES.includes(s.resultPolicy)) {
    invalid("resultPolicy", "Unbekannte Regel für die Resultatbestätigung.");
  }
  return s;
}

/** True when two parameter sets would produce different ratings (a replay is needed). */
export function paramsDiffer(a: EloParams, b: EloParams): boolean {
  return (
    a.initialRating !== b.initialRating ||
    a.kFactor !== b.kFactor ||
    a.ratingScale !== b.ratingScale ||
    a.repeatMultipliers.length !== b.repeatMultipliers.length ||
    a.repeatMultipliers.some((x, i) => x !== b.repeatMultipliers[i])
  );
}
