import { describe, expect, it } from "vitest";
import { mulberry32, seededRng } from "./rng";

describe("seededRng", () => {
  it("reproduces the sequences used by the dev scenarios and the full-event simulation", () => {
    // Captured from the original implementation in simulate-tournament.ts before it moved here.
    const take = (seed: number) => {
      const rng = seededRng(seed);
      return Array.from({ length: 10 }, () => rng(1000));
    };
    expect(take(42)).toEqual([601, 448, 852, 669, 174, 526, 273, 624, 865, 472]);
    expect(take(7)).toEqual([11, 61, 976, 699, 521, 405, 466, 239, 553, 729]);
  });

  it("stays within [0, maxExclusive)", () => {
    const rng = seededRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng(3);
      expect(Number.isInteger(v) && v >= 0 && v < 3).toBe(true);
    }
  });
});

describe("mulberry32", () => {
  it("returns floats in [0, 1) and is deterministic per seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
    expect(mulberry32(6)()).not.toBe(mulberry32(5)());
  });
});
