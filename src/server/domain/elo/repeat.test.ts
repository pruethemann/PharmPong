import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { DEFAULT_ELO_PARAMS } from "./config";
import { multiplierFor, ratingTier, rosterPairKey } from "./repeat";

describe("rosterPairKey", () => {
  it("normalizes player order and swapped sides", () => {
    const key = rosterPairKey(["anna", "ben"], ["carla"]);
    expect(rosterPairKey(["ben", "anna"], ["carla"])).toBe(key);
    expect(rosterPairKey(["carla"], ["anna", "ben"])).toBe(key);
  });

  it("distinguishes different pairings, also when a player changes sides", () => {
    const key = rosterPairKey(["a", "b"], ["c"]);
    expect(rosterPairKey(["a"], ["b", "c"])).not.toBe(key);
    expect(rosterPairKey(["a", "b"], ["d"])).not.toBe(key);
    expect(rosterPairKey(["a", "b"], ["c", "d"])).not.toBe(key);
  });

  it("is equal exactly when the unordered pairs of sides are equal", () => {
    const side = fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e"), { minLength: 1, maxLength: 4 });
    const unordered = (x: string[], y: string[]) =>
      [JSON.stringify([...x].sort()), JSON.stringify([...y].sort())].sort().join("|");
    fc.assert(
      fc.property(side, side, side, side, (a, b, c, d) => {
        expect(rosterPairKey(a, b) === rosterPairKey(c, d)).toBe(unordered(a, b) === unordered(c, d));
        expect(rosterPairKey(b, a)).toBe(rosterPairKey([...a].reverse(), [...b].reverse()));
      }),
    );
  });
});

describe("multiplierFor (spec §7.5 defaults)", () => {
  const m = DEFAULT_ELO_PARAMS.repeatMultipliers;

  it("rates the 1st and 2nd meeting fully, the 3rd half and the 4th and later not at all", () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => multiplierFor(n, m))).toEqual([1, 1, 0.5, 0, 0, 0]);
  });

  it("can be disabled with a single factor of 1", () => {
    expect([0, 1, 5, 50].map((n) => multiplierFor(n, [1]))).toEqual([1, 1, 1, 1]);
  });

  it("rejects invalid counts and an empty schedule", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => multiplierFor(bad, m)).toThrow();
    }
    try {
      multiplierFor(0, []);
      expect.unreachable();
    } catch (e) {
      expect(isDomainError(e) && e.code).toBe("VALIDATION");
    }
  });
});

describe("ratingTier", () => {
  it("labels full, partial and unrated meetings", () => {
    expect(ratingTier(1)).toBe("FULL");
    expect(ratingTier(0.5)).toBe("PARTIAL");
    expect(ratingTier(0.01)).toBe("PARTIAL");
    expect(ratingTier(0)).toBe("UNRATED");
  });
});
