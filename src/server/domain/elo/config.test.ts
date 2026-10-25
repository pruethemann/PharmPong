import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import {
  DEFAULT_ELO_CONFIG,
  DEFAULT_ELO_PARAMS,
  DEFAULT_SESSION_SETTINGS,
  DRAFT_TTL_MINUTES,
  paramsDiffer,
  validateEloParams,
  validateSessionSettings,
  type EloSessionSettings,
} from "./config";
import type { EloParams } from "./types";

function fieldOf(fn: () => unknown): string {
  try {
    fn();
    return "OK";
  } catch (e) {
    if (!isDomainError(e)) throw e;
    expect(e.code).toBe("VALIDATION");
    expect(e.message).not.toMatch(/ß/);
    return String((e.details as { field?: string }).field);
  }
}

describe("defaults (spec §9.1)", () => {
  it("are the spec values, verbatim", () => {
    expect(DEFAULT_ELO_CONFIG).toEqual({
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
    });
  });

  it("derive the run parameters and session settings", () => {
    expect(DEFAULT_ELO_PARAMS).toEqual({
      initialRating: 100,
      kFactor: 24,
      ratingScale: 100,
      repeatMultipliers: [1, 1, 0.5, 0],
    });
    expect(DEFAULT_SESSION_SETTINGS).toEqual({
      minTeamSize: 1,
      maxTeamSize: 4,
      minGamesForChampion: 3,
      softReminderMinutes: 20,
      resultPolicy: "DUAL_TEAM_CONFIRMATION",
    });
    expect(DRAFT_TTL_MINUTES).toBe(10);
  });

  it("are valid", () => {
    expect(validateEloParams(DEFAULT_ELO_PARAMS)).toBe(DEFAULT_ELO_PARAMS);
    expect(validateSessionSettings(DEFAULT_SESSION_SETTINGS)).toBe(DEFAULT_SESSION_SETTINGS);
  });
});

describe("validateEloParams", () => {
  const p = (patch: Partial<EloParams>) => () => validateEloParams({ ...DEFAULT_ELO_PARAMS, ...patch });

  it("accepts the boundaries", () => {
    for (const patch of [
      { initialRating: 0 },
      { initialRating: 10_000 },
      { kFactor: 100 },
      { kFactor: 0.001 },
      { ratingScale: 10 },
      { ratingScale: 1000 },
      { repeatMultipliers: [1] }, // safeguard disabled
      { repeatMultipliers: [1, 0.75, 0.5, 0.25, 0, 0, 0, 0, 0, 0] },
    ]) {
      expect(fieldOf(p(patch))).toBe("OK");
    }
  });

  it("rejects out-of-range and non-finite values with the field name", () => {
    expect(fieldOf(p({ initialRating: -1 }))).toBe("initialRating");
    expect(fieldOf(p({ initialRating: 10_001 }))).toBe("initialRating");
    expect(fieldOf(p({ initialRating: Number.NaN }))).toBe("initialRating");
    expect(fieldOf(p({ kFactor: 0 }))).toBe("kFactor");
    expect(fieldOf(p({ kFactor: 100.5 }))).toBe("kFactor");
    expect(fieldOf(p({ kFactor: Infinity }))).toBe("kFactor");
    expect(fieldOf(p({ ratingScale: 9 }))).toBe("ratingScale");
    expect(fieldOf(p({ ratingScale: 1001 }))).toBe("ratingScale");
    expect(fieldOf(p({ repeatMultipliers: [] }))).toBe("repeatMultipliers");
    expect(fieldOf(p({ repeatMultipliers: Array(11).fill(1) }))).toBe("repeatMultipliers");
    expect(fieldOf(p({ repeatMultipliers: [1, 1.5] }))).toBe("repeatMultipliers");
    expect(fieldOf(p({ repeatMultipliers: [1, -0.1] }))).toBe("repeatMultipliers");
    expect(fieldOf(p({ repeatMultipliers: [1, Number.NaN] }))).toBe("repeatMultipliers");
  });
});

describe("validateSessionSettings", () => {
  const s = (patch: Partial<EloSessionSettings>) => () =>
    validateSessionSettings({ ...DEFAULT_SESSION_SETTINGS, ...patch });

  it("accepts narrowed team sizes, a disabled reminder and the referee-only policy", () => {
    expect(fieldOf(s({ minTeamSize: 2, maxTeamSize: 2 }))).toBe("OK");
    expect(fieldOf(s({ softReminderMinutes: null }))).toBe("OK");
    expect(fieldOf(s({ resultPolicy: "REFEREE_ONLY" }))).toBe("OK");
    expect(fieldOf(s({ minGamesForChampion: 0 }))).toBe("OK");
  });

  it("rejects invalid values with the field name", () => {
    expect(fieldOf(s({ minTeamSize: 0 }))).toBe("minTeamSize");
    expect(fieldOf(s({ minTeamSize: 1.5 }))).toBe("minTeamSize");
    expect(fieldOf(s({ maxTeamSize: 5 }))).toBe("maxTeamSize");
    expect(fieldOf(s({ minTeamSize: 3, maxTeamSize: 2 }))).toBe("maxTeamSize");
    expect(fieldOf(s({ minGamesForChampion: 101 }))).toBe("minGamesForChampion");
    expect(fieldOf(s({ minGamesForChampion: -1 }))).toBe("minGamesForChampion");
    expect(fieldOf(s({ softReminderMinutes: 0 }))).toBe("softReminderMinutes");
    expect(fieldOf(s({ softReminderMinutes: 241 }))).toBe("softReminderMinutes");
    expect(fieldOf(s({ softReminderMinutes: 2.5 }))).toBe("softReminderMinutes");
    expect(fieldOf(s({ resultPolicy: "MAJORITY" as EloSessionSettings["resultPolicy"] }))).toBe(
      "resultPolicy",
    );
  });
});

describe("paramsDiffer", () => {
  it("detects every rating-relevant change", () => {
    expect(paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS })).toBe(false);
    expect(
      paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, repeatMultipliers: [1, 1, 0.5, 0] }),
    ).toBe(false);
    expect(paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, initialRating: 1000 })).toBe(true);
    expect(paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, kFactor: 32 })).toBe(true);
    expect(paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, ratingScale: 400 })).toBe(true);
    expect(paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, repeatMultipliers: [1, 1, 0.5] })).toBe(
      true,
    );
    expect(
      paramsDiffer(DEFAULT_ELO_PARAMS, { ...DEFAULT_ELO_PARAMS, repeatMultipliers: [1, 1, 0.25, 0] }),
    ).toBe(true);
  });
});
