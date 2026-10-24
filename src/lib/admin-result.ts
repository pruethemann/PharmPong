// Client-side pre-check of an admin result correction. Uses the same pure domain
// rules as the server; the server stays authoritative.
import { isDomainError } from "@/server/domain/errors";
import { validateResult } from "@/server/domain/result-rules";
import type { EndTypeKey } from "@/lib/i18n/de";

export type AdminResultDraft = {
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: EndTypeKey;
};

/** Null when valid, else the German reason. */
export function checkAdminResult(d: AdminResultDraft): string | null {
  try {
    validateResult(d, { allowForfeit: true });
    return null;
  } catch (e) {
    if (isDomainError(e)) return e.message;
    return "Dieses Resultat ist nicht gültig.";
  }
}

/** Forfeit results are stored as 10 (winner) : 0 (loser). */
export function normalizeAdminResult(d: AdminResultDraft): AdminResultDraft {
  if (d.endType !== "FORFEIT") return d;
  const homeWins = d.winnerTeamId === d.homeTeamId;
  return { ...d, homeCupsRemaining: homeWins ? 10 : 0, awayCupsRemaining: homeWins ? 0 : 10 };
}

/** True when the draft differs from the current confirmed result. */
export function resultChanged(
  d: Pick<AdminResultDraft, "winnerTeamId" | "homeCupsRemaining" | "awayCupsRemaining" | "endType">,
  current: {
    winnerTeamId: string;
    homeCupsRemaining: number;
    awayCupsRemaining: number;
    endType: EndTypeKey;
  } | null,
): boolean {
  if (!current) return true;
  return (
    d.winnerTeamId !== current.winnerTeamId ||
    d.homeCupsRemaining !== current.homeCupsRemaining ||
    d.awayCupsRemaining !== current.awayCupsRemaining ||
    d.endType !== current.endType
  );
}
