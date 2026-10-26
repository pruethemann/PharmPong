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

const countsAs = (m: number): string =>
  m >= 1
    ? "zählt voll"
    : m <= 0
      ? "zählt nicht mehr"
      : m === 0.5
        ? "zählt zur Hälfte"
        : `zählt zu ${Math.round(m * 100)}\u00a0%`;

/**
 * The repeat-match rule in words, consecutive equal values grouped:
 * [1, 1, 0.5, 0] → ["1. und 2. Begegnung: zählt voll", "3. Begegnung: zählt zur Hälfte",
 * "ab der 4. Begegnung: zählt nicht mehr"].
 */
export function repeatRuleLines(multipliers: readonly number[]): string[] {
  if (multipliers.length === 0) return [];
  if (multipliers.every((m) => m === multipliers[0])) return [`Jede Begegnung ${countsAs(multipliers[0])}`];
  const lines: string[] = [];
  let start = 0;
  for (let i = 1; i <= multipliers.length; i++) {
    if (i < multipliers.length && multipliers[i] === multipliers[start]) continue;
    const last = i === multipliers.length;
    const from = start + 1;
    const to = i;
    const label = last
      ? `ab der ${from}. Begegnung`
      : from === to
        ? `${from}. Begegnung`
        : to === from + 1
          ? `${from}. und ${to}. Begegnung`
          : `${from}. bis ${to}. Begegnung`;
    lines.push(`${label}: ${countsAs(multipliers[start])}`);
    start = i;
  }
  return lines;
}
