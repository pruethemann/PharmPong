// Elo match results: a winner is mandatory (no draws); remaining cups are optional and never
// influence the rating.
import { fail } from "../errors";
import { CUPS_PER_SIDE } from "../types";
import type { EloEndType, Side } from "./types";

export type EloResultInput = {
  winnerSide: Side;
  endType: EloEndType;
  cupsRemainingA?: number | null;
  cupsRemainingB?: number | null;
};

export type EloResult = {
  winnerSide: Side;
  endType: EloEndType;
  cupsRemainingA: number | null;
  cupsRemainingB: number | null;
};

function invalid(reason: string, message: string): never {
  fail("INVALID_RESULT", message, { reason });
}

const isCupCount = (n: number) => Number.isInteger(n) && n >= 0 && n <= CUPS_PER_SIDE;

/** Validates a submitted result and returns it normalized (missing cups as null). */
export function validateEloResult(input: EloResultInput): EloResult {
  if (input.winnerSide !== "A" && input.winnerSide !== "B") {
    invalid("NO_WINNER", "Es gibt kein Unentschieden: Bitte das Siegerteam wählen.");
  }
  if (input.endType !== "REGULAR" && input.endType !== "CONCEDED") {
    invalid("UNKNOWN_END_TYPE", "Unbekannte Art des Spielendes.");
  }
  const cupsA = input.cupsRemainingA ?? null;
  const cupsB = input.cupsRemainingB ?? null;
  for (const c of [cupsA, cupsB]) {
    if (c !== null && !isCupCount(c)) {
      invalid(
        "CUPS_OUT_OF_RANGE",
        `Verbleibende Becher müssen ganze Zahlen von 0 bis ${CUPS_PER_SIDE} sein.`,
      );
    }
  }
  const winnerLeft = input.winnerSide === "A" ? cupsA : cupsB;
  const loserLeft = input.winnerSide === "A" ? cupsB : cupsA;
  if (winnerLeft !== null && winnerLeft < 1) {
    invalid("WINNER_NO_CUPS", "Das Siegerteam muss noch mindestens einen Becher haben.");
  }
  if (input.endType === "REGULAR" && loserLeft !== null && loserLeft !== 0) {
    invalid("REGULAR_LOSER_HAS_CUPS", "Bei regulärem Spielende hat das unterlegene Team keine Becher mehr.");
  }
  return {
    winnerSide: input.winnerSide,
    endType: input.endType,
    cupsRemainingA: cupsA,
    cupsRemainingB: cupsB,
  };
}
