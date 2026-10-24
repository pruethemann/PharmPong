import { fail } from "./errors";
import { CUPS_PER_SIDE, type EndType, type MatchResult, type Slot } from "./types";

export type ResultInput = {
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: EndType;
};

function invalid(reason: string, message: string): never {
  fail("INVALID_RESULT", message, { reason });
}

const isCupCount = (n: number) => Number.isInteger(n) && n >= 0 && n <= CUPS_PER_SIDE;

/** Validates a proposed result and returns the normalized MatchResult. */
export function validateResult(input: ResultInput, opts?: { allowForfeit?: boolean }): MatchResult {
  const { homeTeamId, awayTeamId, winnerTeamId, homeCupsRemaining, awayCupsRemaining, endType } = input;
  if (!isCupCount(homeCupsRemaining) || !isCupCount(awayCupsRemaining)) {
    invalid("CUPS_OUT_OF_RANGE", `Verbleibende Becher müssen ganze Zahlen von 0 bis ${CUPS_PER_SIDE} sein.`);
  }
  if (homeTeamId === awayTeamId) {
    invalid("SAME_TEAMS", "Heim- und Gastteam müssen verschieden sein.");
  }
  if (winnerTeamId !== homeTeamId && winnerTeamId !== awayTeamId) {
    invalid("WINNER_NOT_IN_MATCH", "Das Siegerteam muss eines der beiden Teams sein.");
  }
  const homeWins = winnerTeamId === homeTeamId;
  const winnerLeft = homeWins ? homeCupsRemaining : awayCupsRemaining;
  const loserLeft = homeWins ? awayCupsRemaining : homeCupsRemaining;

  switch (endType) {
    case "REGULAR":
      if (loserLeft !== 0) {
        invalid(
          "REGULAR_LOSER_HAS_CUPS",
          "Bei regulärem Spielende hat das unterlegene Team keine Becher mehr.",
        );
      }
      if (winnerLeft < 1) {
        invalid("REGULAR_WINNER_NO_CUPS", "Das Siegerteam muss noch mindestens einen Becher haben.");
      }
      break;
    case "TIME_LIMIT":
      if (winnerLeft < 1 || loserLeft < 1) {
        invalid("TIME_LIMIT_ZERO_CUPS", "Bei Zeitablauf haben beide Teams noch mindestens einen Becher.");
      }
      if (winnerLeft <= loserLeft) {
        invalid(
          "TIME_LIMIT_WINNER_NOT_AHEAD",
          "Bei Zeitablauf gewinnt das Team mit mehr verbleibenden Bechern.",
        );
      }
      break;
    case "SHOOTOUT":
      if (winnerLeft !== loserLeft || winnerLeft < 1) {
        invalid(
          "SHOOTOUT_NOT_TIED",
          "Ein Shootout gibt es nur bei gleich vielen verbleibenden Bechern (mindestens einer) bei Zeitablauf.",
        );
      }
      break;
    case "FORFEIT":
      if (!opts?.allowForfeit) {
        invalid("FORFEIT_NOT_ALLOWED", "Forfait-Siege kann nur die Turnierleitung erfassen.");
      }
      return forfeitResult(homeTeamId, awayTeamId, winnerTeamId);
    default:
      invalid("UNKNOWN_END_TYPE", "Unbekannte Art des Spielendes.");
  }
  return { winnerTeamId, homeCupsRemaining, awayCupsRemaining, endType };
}

/** Forfeit: counted as 10:0 for the winner. */
export function forfeitResult(homeTeamId: string, awayTeamId: string, winnerTeamId: string): MatchResult {
  if (winnerTeamId !== homeTeamId && winnerTeamId !== awayTeamId) {
    invalid("WINNER_NOT_IN_MATCH", "Das Siegerteam muss eines der beiden Teams sein.");
  }
  const homeWins = winnerTeamId === homeTeamId;
  return {
    winnerTeamId,
    homeCupsRemaining: homeWins ? CUPS_PER_SIDE : 0,
    awayCupsRemaining: homeWins ? 0 : CUPS_PER_SIDE,
    endType: "FORFEIT",
  };
}

/** Regulation cup statistics for one side. A shootout adds nothing. */
export function cupStats(result: MatchResult, side: Slot): { cupsFor: number; cupsAgainst: number } {
  const own = side === "HOME" ? result.homeCupsRemaining : result.awayCupsRemaining;
  const opp = side === "HOME" ? result.awayCupsRemaining : result.homeCupsRemaining;
  return { cupsFor: CUPS_PER_SIDE - opp, cupsAgainst: CUPS_PER_SIDE - own };
}
