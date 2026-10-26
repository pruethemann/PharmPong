import { describe, expect, it } from "vitest";
import {
  avatarTone,
  firstName,
  formatDelta,
  formatPercent,
  formatRating,
  gamesLabel,
  ratingLabels,
  teamLabel,
} from "./elo-format";

describe("Elo display helpers", () => {
  it("labels temporary teams from their players", () => {
    expect(teamLabel([])).toBe("–");
    expect(teamLabel(["Anna"])).toBe("Anna");
    expect(teamLabel(["Anna", "Ben"])).toBe("Anna & Ben");
    expect(teamLabel(["Anna", "Ben", "Carla", "Dario"])).toBe("Anna, Ben, Carla & Dario");
    expect(firstName("Anna M.")).toBe("Anna");
  });

  it("rounds ratings for display only and signs changes", () => {
    expect(formatRating(112.49)).toBe("112");
    expect(formatRating(87.5)).toBe("88");
    expect(formatDelta(8.583)).toBe("+8.6");
    expect(formatDelta(-3)).toBe("−3.0");
    expect(formatDelta(0.04)).toBe("±0.0");
    expect(formatPercent(0.2847)).toBe("28 %");
    expect(gamesLabel(1)).toBe("1 Spiel");
    expect(gamesLabel(3)).toBe("3 Spiele");
  });

  it("shows one decimal only where neighbours would otherwise look equal", () => {
    expect(ratingLabels([138.2, 125.4, 112.4, 112.3, 99])).toEqual(["138", "125", "112.4", "112.3", "99"]);
    // Genuinely equal ratings stay integers (they share a rank).
    expect(ratingLabels([106, 106, 94])).toEqual(["106", "106", "94"]);
  });

  it("gives every user a stable avatar tone", () => {
    expect(avatarTone("cmuser1")).toBe(avatarTone("cmuser1"));
    const tones = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(avatarTone));
    expect([...tones].every((t) => t >= 1 && t <= 5)).toBe(true);
    expect(tones.size).toBeGreaterThan(2);
  });
});
