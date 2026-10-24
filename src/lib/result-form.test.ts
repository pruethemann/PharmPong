import { describe, expect, it } from "vitest";
import {
  checkDraft,
  clampCups,
  clearIdempotencyKey,
  cupsScored,
  draftFromProposal,
  draftToResult,
  EMPTY_DRAFT,
  getOrCreateIdempotencyKey,
  hasIdempotencyKey,
  idempotencyStorageKey,
  resultSummary,
  suggestWinner,
  withCups,
  withEndType,
  type KeyStore,
  type ResultDraft,
} from "./result-form";

const names = { home: "Laborratten", away: "Pipettenprofis" };
const draft = (p: Partial<ResultDraft>): ResultDraft => ({ ...EMPTY_DRAFT, ...p });

function memoryStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("cups", () => {
  it("clamps to 0..10 integers", () => {
    expect(clampCups(-1)).toBe(0);
    expect(clampCups(11)).toBe(10);
    expect(clampCups(3.6)).toBe(4);
    expect(clampCups(Number.NaN)).toBe(0);
  });

  it("cups scored = 10 − opponent remaining", () => {
    expect(cupsScored("home", 3, 0)).toBe(10);
    expect(cupsScored("away", 3, 0)).toBe(7);
    expect(cupsScored("home", 10, 10)).toBe(0);
  });

  it("withCups / withEndType keep the rest of the draft", () => {
    const d = withCups(withEndType(draft({ winner: "home" }), "TIME_LIMIT"), "away", 12);
    expect(d).toEqual({ endType: "TIME_LIMIT", homeCups: 10, awayCups: 10, winner: "home" });
  });
});

describe("suggestWinner", () => {
  it("REGULAR: the side with 0 cups left loses", () => {
    expect(suggestWinner({ endType: "REGULAR", homeCups: 3, awayCups: 0 })).toBe("home");
    expect(suggestWinner({ endType: "REGULAR", homeCups: 0, awayCups: 1 })).toBe("away");
    expect(suggestWinner({ endType: "REGULAR", homeCups: 0, awayCups: 0 })).toBeNull();
    expect(suggestWinner({ endType: "REGULAR", homeCups: 2, awayCups: 2 })).toBeNull();
  });

  it("TIME_LIMIT: more own cups standing wins", () => {
    expect(suggestWinner({ endType: "TIME_LIMIT", homeCups: 4, awayCups: 2 })).toBe("home");
    expect(suggestWinner({ endType: "TIME_LIMIT", homeCups: 1, awayCups: 5 })).toBe("away");
    expect(suggestWinner({ endType: "TIME_LIMIT", homeCups: 3, awayCups: 3 })).toBeNull();
  });

  it("SHOOTOUT and no end type: never suggests", () => {
    expect(suggestWinner({ endType: "SHOOTOUT", homeCups: 3, awayCups: 3 })).toBeNull();
    expect(suggestWinner({ endType: null, homeCups: 3, awayCups: 0 })).toBeNull();
  });
});

describe("checkDraft", () => {
  const fields = (d: ResultDraft) => checkDraft(d, names).hints.map((h) => h.field);

  it("asks for the end type first", () => {
    const c = checkDraft(EMPTY_DRAFT, names);
    expect(c.valid).toBe(false);
    expect(c.hints[0]).toEqual({ field: "endType", text: "Wähle zuerst, wie das Spiel geendet hat." });
  });

  it("valid REGULAR result after an explicit winner tap", () => {
    expect(
      checkDraft(draft({ endType: "REGULAR", homeCups: 3, awayCups: 0, winner: "home" }), names),
    ).toEqual({ valid: true, hints: [], suggested: "home" });
  });

  it("requires a winner tap even when the winner is obvious", () => {
    const c = checkDraft(draft({ endType: "REGULAR", homeCups: 3, awayCups: 0 }), names);
    expect(c.valid).toBe(false);
    expect(c.suggested).toBe("home");
    expect(c.hints).toEqual([
      { field: "winner", text: "Vorschlag: Laborratten. Tippe zum Bestätigen auf das Siegerteam." },
    ]);
  });

  it("REGULAR: someone must be at 0, not both", () => {
    expect(fields(draft({ endType: "REGULAR", homeCups: 3, awayCups: 2, winner: "home" }))).toEqual(["cups"]);
    expect(fields(draft({ endType: "REGULAR", homeCups: 0, awayCups: 0, winner: "home" }))).toEqual(["cups"]);
  });

  it("REGULAR: the side at 0 cannot win", () => {
    const c = checkDraft(draft({ endType: "REGULAR", homeCups: 0, awayCups: 4, winner: "home" }), names);
    expect(c.valid).toBe(false);
    expect(c.hints[0].field).toBe("winner");
    expect(c.hints[0].text).toContain("Sieger ist Pipettenprofis");
  });

  it("TIME_LIMIT: both sides need cups and must differ", () => {
    expect(fields(draft({ endType: "TIME_LIMIT", homeCups: 0, awayCups: 4, winner: "away" }))).toEqual([
      "cups",
    ]);
    const tie = checkDraft(draft({ endType: "TIME_LIMIT", homeCups: 3, awayCups: 3, winner: "home" }), names);
    expect(tie.hints[0].text).toContain("Shootout");
    expect(tie.valid).toBe(false);
  });

  it("TIME_LIMIT: winner must be ahead", () => {
    const wrong = checkDraft(
      draft({ endType: "TIME_LIMIT", homeCups: 2, awayCups: 5, winner: "home" }),
      names,
    );
    expect(wrong.valid).toBe(false);
    expect(wrong.hints[0].text).toContain("mehr Bechern (Pipettenprofis)");
    expect(
      checkDraft(draft({ endType: "TIME_LIMIT", homeCups: 2, awayCups: 5, winner: "away" }), names).valid,
    ).toBe(true);
  });

  it("SHOOTOUT: equal cups (≥1) required, winner is the shootout winner", () => {
    expect(fields(draft({ endType: "SHOOTOUT", homeCups: 3, awayCups: 2, winner: "home" }))).toEqual([
      "cups",
    ]);
    expect(fields(draft({ endType: "SHOOTOUT", homeCups: 0, awayCups: 0, winner: "home" }))).toEqual([
      "cups",
    ]);
    const noWinner = checkDraft(draft({ endType: "SHOOTOUT", homeCups: 2, awayCups: 2 }), names);
    expect(noWinner.hints[0].text).toContain("Shootout gewonnen");
    expect(
      checkDraft(draft({ endType: "SHOOTOUT", homeCups: 2, awayCups: 2, winner: "away" }), names).valid,
    ).toBe(true);
  });
});

describe("draft mapping", () => {
  const ids = { home: "t1", away: "t2" };

  it("maps a complete draft to the action payload", () => {
    expect(
      draftToResult(draft({ endType: "TIME_LIMIT", homeCups: 4, awayCups: 1, winner: "home" }), ids),
    ).toEqual({
      winnerTeamId: "t1",
      homeCupsRemaining: 4,
      awayCupsRemaining: 1,
      endType: "TIME_LIMIT",
    });
    expect(draftToResult(draft({ endType: "TIME_LIMIT" }), ids)).toBeNull();
  });

  it("prefills from a server proposal", () => {
    expect(
      draftFromProposal(
        { winnerTeamId: "t2", homeCupsRemaining: 0, awayCupsRemaining: 3, endType: "REGULAR" },
        ids,
      ),
    ).toEqual({ endType: "REGULAR", homeCups: 0, awayCups: 3, winner: "away" });
    expect(
      draftFromProposal(
        { winnerTeamId: "x", homeCupsRemaining: 10, awayCupsRemaining: 0, endType: "FORFEIT" },
        ids,
      ),
    ).toEqual({ endType: null, homeCups: 10, awayCups: 0, winner: null });
  });

  it("builds the review summary", () => {
    expect(
      resultSummary({
        winnerName: "Laborratten",
        homeCupsRemaining: 3,
        awayCupsRemaining: 0,
        endType: "TIME_LIMIT",
      }),
    ).toBe("Laborratten gewinnt · 3 : 0 Becher übrig · Zeitablauf");
  });
});

describe("idempotency keys", () => {
  it("reuses the stored key for the same match, step and revision", () => {
    const store = memoryStore();
    let n = 0;
    const gen = () => `key-000${++n}`;
    const a = getOrCreateIdempotencyKey(store, "m1", "confirm", 2, gen);
    const b = getOrCreateIdempotencyKey(store, "m1", "confirm", 2, gen);
    expect(a).toBe("key-0001");
    expect(b).toBe(a);
    expect(store.map.get(idempotencyStorageKey("m1", "confirm", 2))).toBe(a);
  });

  it("uses distinct keys per step and revision", () => {
    const store = memoryStore();
    let n = 0;
    const gen = () => `key-000${++n}`;
    const keys = new Set([
      getOrCreateIdempotencyKey(store, "m1", "propose", 1, gen),
      getOrCreateIdempotencyKey(store, "m1", "confirm", 1, gen),
      getOrCreateIdempotencyKey(store, "m1", "confirm", 2, gen),
      getOrCreateIdempotencyKey(store, "m2", "confirm", 2, gen),
    ]);
    expect(keys.size).toBe(4);
  });

  it("reports a key as pending until it is cleared", () => {
    const store = memoryStore();
    expect(hasIdempotencyKey(store, "m1", "confirm", 3)).toBe(false);
    getOrCreateIdempotencyKey(store, "m1", "confirm", 3, () => "key-pending");
    expect(hasIdempotencyKey(store, "m1", "confirm", 3)).toBe(true);
    expect(hasIdempotencyKey(store, "m1", "confirm", 4)).toBe(false);
    expect(hasIdempotencyKey(store, "m1", "propose", 3)).toBe(false);
    clearIdempotencyKey(store, "m1", "confirm", 3);
    expect(hasIdempotencyKey(store, "m1", "confirm", 3)).toBe(false);
    expect(hasIdempotencyKey(null, "m1", "confirm", 3)).toBe(false);
  });

  it("creates a new key after clearing", () => {
    const store = memoryStore();
    let n = 0;
    const gen = () => `key-000${++n}`;
    const a = getOrCreateIdempotencyKey(store, "m1", "propose", 0, gen);
    clearIdempotencyKey(store, "m1", "propose", 0);
    expect(getOrCreateIdempotencyKey(store, "m1", "propose", 0, gen)).not.toBe(a);
  });

  it("works without storage and survives throwing storage", () => {
    expect(getOrCreateIdempotencyKey(null, "m1", "propose", 0, () => "fallback-key")).toBe("fallback-key");
    const broken: KeyStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(getOrCreateIdempotencyKey(broken, "m1", "propose", 0, () => "fallback-key")).toBe("fallback-key");
    expect(() => clearIdempotencyKey(broken, "m1", "propose", 0)).not.toThrow();
  });

  it("default generator yields a UUID", () => {
    expect(getOrCreateIdempotencyKey(null, "m1", "propose", 0)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
