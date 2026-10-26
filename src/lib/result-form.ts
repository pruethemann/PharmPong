// Pure logic for the referee result form (step 1: enter, step 2: review).
// Mirrors src/server/domain/result-rules.ts; the server re-validates everything.
import { validateResult } from "@/server/domain/result-rules";
import { isDomainError } from "@/server/domain/errors";

export const CUPS_PER_SIDE = 10;

export type RefereeEndType = "REGULAR" | "TIME_LIMIT" | "SHOOTOUT";
export type Side = "home" | "away";

export const REFEREE_END_TYPES: readonly RefereeEndType[] = ["REGULAR", "TIME_LIMIT", "SHOOTOUT"];

export type ResultDraft = {
  endType: RefereeEndType | null;
  homeCups: number;
  awayCups: number;
  /** Only set by an explicit tap of the referee. */
  winner: Side | null;
};

export const EMPTY_DRAFT: ResultDraft = {
  endType: null,
  homeCups: CUPS_PER_SIDE,
  awayCups: CUPS_PER_SIDE,
  winner: null,
};

export const clampCups = (n: number): number =>
  Math.min(CUPS_PER_SIDE, Math.max(0, Number.isFinite(n) ? Math.round(n) : 0));

export const otherSide = (s: Side): Side => (s === "home" ? "away" : "home");

/** Cups a side scored = 10 − opponent's remaining cups. */
export function cupsScored(side: Side, homeCups: number, awayCups: number): number {
  return CUPS_PER_SIDE - (side === "home" ? awayCups : homeCups);
}

/**
 * Winner implied by the cups (a suggestion only, the referee must tap to confirm):
 * - REGULAR: the side with 0 cups left loses (exactly one side at 0)
 * - TIME_LIMIT: the side with more own cups standing wins
 * - SHOOTOUT / unknown end type: no suggestion (decided by the shootout)
 */
export function suggestWinner(d: Pick<ResultDraft, "endType" | "homeCups" | "awayCups">): Side | null {
  const { endType, homeCups: h, awayCups: a } = d;
  if (endType === "REGULAR") {
    if (h === 0 && a > 0) return "away";
    if (a === 0 && h > 0) return "home";
    return null;
  }
  if (endType === "TIME_LIMIT") {
    if (h > a) return "home";
    if (a > h) return "away";
    return null;
  }
  return null;
}

export type HintField = "endType" | "cups" | "winner";
export type Hint = { field: HintField; text: string };

export type DraftCheck = {
  /** True when the draft would pass the server-side validation. */
  valid: boolean;
  hints: Hint[];
  suggested: Side | null;
};

/**
 * Live validation with German hints per control. `names` are used in the
 * winner hint ("<Team> kann so nicht gewinnen").
 */
export function checkDraft(d: ResultDraft, names: { home: string; away: string }): DraftCheck {
  const hints: Hint[] = [];
  const { endType, homeCups: h, awayCups: a, winner } = d;
  const suggested = suggestWinner(d);

  if (!endType) {
    hints.push({ field: "endType", text: "Wähle zuerst, wie das Spiel geendet hat." });
  } else if (endType === "REGULAR") {
    if (h === 0 && a === 0) {
      hints.push({ field: "cups", text: "Nur ein Team kann 0 Becher übrig haben." });
    } else if (h > 0 && a > 0) {
      hints.push({
        field: "cups",
        text: "Alle Becher getroffen: Beim unterlegenen Team stehen 0 Becher. Sonst «Zeitablauf» wählen.",
      });
    }
  } else if (endType === "TIME_LIMIT") {
    if (h === 0 || a === 0) {
      hints.push({
        field: "cups",
        text: "Bei Zeitablauf haben beide Teams noch mindestens 1 Becher. Sonst «Alle Becher getroffen» wählen.",
      });
    } else if (h === a) {
      hints.push({
        field: "cups",
        text: "Gleich viele Becher nach Zeitablauf: Das entscheidet ein Shootout.",
      });
    }
  } else if (endType === "SHOOTOUT") {
    if (h !== a) {
      hints.push({
        field: "cups",
        text: "Shootout nur bei gleich vielen verbleibenden Bechern. Sonst «Zeitablauf» wählen.",
      });
    } else if (h === 0) {
      hints.push({ field: "cups", text: "Beim Shootout haben beide Teams noch mindestens 1 Becher." });
    }
  }

  const cupsOk = !!endType && !hints.some((x) => x.field === "cups");
  if (!winner) {
    hints.push({
      field: "winner",
      text:
        endType === "SHOOTOUT"
          ? "Tippe auf das Team, das den Shootout gewonnen hat."
          : suggested
            ? `Vorschlag: ${names[suggested]}. Tippe zum Bestätigen auf das Siegerteam.`
            : "Tippe auf das Siegerteam.",
    });
  } else if (cupsOk && suggested && winner !== suggested) {
    hints.push({
      field: "winner",
      text:
        endType === "REGULAR"
          ? `${names[winner]} hat keine Becher mehr und kann so nicht gewinnen. Sieger ist ${names[suggested]}.`
          : `${names[winner]} kann so nicht gewinnen: Bei Zeitablauf gewinnt das Team mit mehr Bechern (${names[suggested]}).`,
    });
  }

  let valid = false;
  if (endType && winner && hints.length === 0) {
    try {
      validateResult({
        homeTeamId: "home",
        awayTeamId: "away",
        winnerTeamId: winner,
        homeCupsRemaining: h,
        awayCupsRemaining: a,
        endType,
      });
      valid = true;
    } catch (e) {
      hints.push({ field: "winner", text: isDomainError(e) ? e.message : "Ungültiges Resultat." });
    }
  }
  return { valid, hints, suggested };
}

/** Payload for proposeResultAction (without matchId / version / key). */
export function draftToResult(
  d: ResultDraft,
  ids: { home: string; away: string },
): {
  winnerTeamId: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: RefereeEndType;
} | null {
  if (!d.endType || !d.winner) return null;
  return {
    winnerTeamId: ids[d.winner],
    homeCupsRemaining: d.homeCups,
    awayCupsRemaining: d.awayCups,
    endType: d.endType,
  };
}

/** Prefill the entry form from a (rejected) server proposal. */
export function draftFromProposal(
  p: { winnerTeamId: string; homeCupsRemaining: number; awayCupsRemaining: number; endType: string },
  ids: { home: string | null; away: string | null },
): ResultDraft {
  const endType = (REFEREE_END_TYPES as readonly string[]).includes(p.endType)
    ? (p.endType as RefereeEndType)
    : null;
  return {
    endType,
    homeCups: clampCups(p.homeCupsRemaining),
    awayCups: clampCups(p.awayCupsRemaining),
    winner: p.winnerTeamId === ids.home ? "home" : p.winnerTeamId === ids.away ? "away" : null,
  };
}

/** Set an end type; keeps cups and the explicit winner choice. */
export function withEndType(d: ResultDraft, endType: RefereeEndType): ResultDraft {
  return { ...d, endType };
}

export function withCups(d: ResultDraft, side: Side, value: number): ResultDraft {
  return side === "home" ? { ...d, homeCups: clampCups(value) } : { ...d, awayCups: clampCups(value) };
}

// ─── Idempotency keys ──────────────────────────────────────────────────────

export type IdempotencyStep =
  "propose" | "confirm" | "elo-submit" | "elo-confirm" | "elo-dispute" | "elo-final";

/** Minimal Storage interface (sessionStorage in the browser, a Map in tests). */
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function idempotencyStorageKey(
  matchId: string,
  step: IdempotencyStep,
  resultRevision: number,
): string {
  return `pp:idem:${matchId}:${step}:${resultRevision}`;
}

/**
 * Same key for every retry of the same (match, step, resultRevision), also across
 * reloads, so a resend after a network loss is replayed instead of executed twice.
 */
export function getOrCreateIdempotencyKey(
  store: KeyStore | null,
  matchId: string,
  step: IdempotencyStep,
  resultRevision: number,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const k = idempotencyStorageKey(matchId, step, resultRevision);
  try {
    const existing = store?.getItem(k);
    if (existing && existing.length >= 8) return existing;
  } catch {
    // storage unavailable (private mode): fall through to a fresh key
  }
  const key = generate();
  try {
    store?.setItem(k, key);
  } catch {
    // ignore
  }
  return key;
}

/** True while a key is stored, i.e. a request was sent without a definitive answer yet. */
export function hasIdempotencyKey(
  store: KeyStore | null,
  matchId: string,
  step: IdempotencyStep,
  resultRevision: number,
): boolean {
  try {
    return !!store?.getItem(idempotencyStorageKey(matchId, step, resultRevision));
  } catch {
    return false;
  }
}

/**
 * Forget a key after the server gave a definitive answer (ok, or an error that
 * rolled back the transaction). Network failures keep the key for the retry.
 */
export function clearIdempotencyKey(
  store: KeyStore | null,
  matchId: string,
  step: IdempotencyStep,
  resultRevision: number,
): void {
  try {
    store?.removeItem(idempotencyStorageKey(matchId, step, resultRevision));
  } catch {
    // ignore
  }
}

/** Browser sessionStorage or null (SSR / blocked storage). */
export function sessionKeyStore(): KeyStore | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// ─── Summary text ──────────────────────────────────────────────────────────

const END_TYPE_SHORT: Record<string, string> = {
  REGULAR: "Alle Becher getroffen",
  TIME_LIMIT: "Zeitablauf",
  SHOOTOUT: "Shootout",
  FORFEIT: "Forfait",
};

/** "Laborratten gewinnt · 3 : 0 Becher übrig · Zeitablauf" */
export function resultSummary(r: {
  winnerName: string;
  homeCupsRemaining: number;
  awayCupsRemaining: number;
  endType: string;
}): string {
  return `${r.winnerName} gewinnt · ${r.homeCupsRemaining} : ${r.awayCupsRemaining} Becher übrig · ${
    END_TYPE_SHORT[r.endType] ?? r.endType
  }`;
}
