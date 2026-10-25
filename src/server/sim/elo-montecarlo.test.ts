import { describe, expect, it } from "vitest";
import { analyzeRun, BASE_CONFIG, pearson, simulateEvent, spearman, type Pattern } from "./elo-montecarlo";
import {
  farmingStudy,
  reportMarkdown,
  runScenario,
  SCENARIOS,
  stat,
  type ValidationReport,
} from "./elo-report";

const SEEDS = 20;

describe("PharmaElo Monte Carlo simulation", () => {
  it("is deterministic per seed", () => {
    const a = simulateEvent(BASE_CONFIG, 11);
    const b = simulateEvent(BASE_CONFIG, 11);
    expect(b.entries).toEqual(a.entries);
    expect(analyzeRun(b)).toEqual(analyzeRun(a));
    expect(simulateEvent(BASE_CONFIG, 12).entries).not.toEqual(a.entries);
  });

  it("models the spec's social event: ≥ 40 matches, 24 players, two concurrent tables, irregularities", () => {
    const runs = Array.from({ length: SEEDS }, (_, i) => analyzeRun(simulateEvent(BASE_CONFIG, i + 1)));
    const completed = stat(runs.map((r) => r.matches.completed))!;
    expect(completed.mean).toBeGreaterThanOrEqual(40);
    expect(runs.every((r) => r.players.total === 24 && r.matches.maxConcurrent === 2)).toBe(true);
    const sum = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0);
    expect(sum((r) => r.matches.friendly)).toBeGreaterThan(0);
    expect(sum((r) => r.matches.disputeResolved)).toBeGreaterThan(0);
    expect(sum((r) => r.matches.cancelled + r.matches.voided)).toBeGreaterThan(0);
    expect(sum((r) => r.matches.partial + r.matches.unratedRepeat)).toBeGreaterThan(0);
    expect(sum((r) => r.matches.outOfOrder)).toBeGreaterThan(0);
    expect(runs.every((r) => r.players.neverPlayed > 0)).toBe(true);
  });

  it("conserves rating points and replays reproducibly in every pattern", () => {
    for (const pattern of ["event", "casual", "moderate", "active", "mixed"] as Pattern[]) {
      for (let seed = 1; seed <= 5; seed++) {
        const m = analyzeRun(simulateEvent({ ...BASE_CONFIG, pattern }, seed));
        expect(m.conservationError).toBeLessThan(1e-9);
        if (m.correction) expect(m.correction.reproducible).toBe(true);
      }
    }
  });

  it("leaves casual players provisional (no champion with the default minimum of 3 games)", () => {
    const s = runScenario(
      SCENARIOS.find((x) => x.key === "casual")!,
      SEEDS,
    );
    expect(s.players.eligible!.max).toBe(0);
    expect(s.champion.none).toBe(1);
  });

  it("shows the effect of the repeat safeguard on a farming duo", () => {
    const rows = farmingStudy(50, 6);
    expect(rows.map((r) => r.multiplier)).toEqual([1, 1, 0.5, 0, 0, 0]);
    expect(rows[5].withSafeguard).toBe(rows[2].withSafeguard);
    expect(rows[5].withoutSafeguard).toBeGreaterThan(rows[5].withSafeguard);
  });

  it("renders the report without NaN", () => {
    const report: ValidationReport = {
      generatedAt: "test",
      seeds: 3,
      algorithmVersion: "pharmaelo-v1",
      params: BASE_CONFIG.params,
      minGamesForChampion: 3,
      scenarios: SCENARIOS.map((d) => runScenario(d, 3)),
      whatIfs: [],
      farming: farmingStudy(3, 4),
      showcase: (() => {
        const run = simulateEvent(BASE_CONFIG, 7);
        return {
          seed: 7,
          matches: run.entries.length,
          leaderboard: [],
          achievements: { mostActive: null, biggestUpset: null, bestComeback: null },
          metrics: analyzeRun(run),
        };
      })(),
    };
    const md = reportMarkdown(report);
    expect(md).toContain("### Rating distribution and conservation");
    expect(md).not.toMatch(/NaN|undefined/);
  });
});

describe("statistics helpers", () => {
  it("computes Pearson and Spearman correlations", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(spearman([10, 20, 30, 40], [1, 3, 2, 4])).toBeCloseTo(0.8, 12);
    expect(spearman([1, 2, 2, 3], [1, 2, 2, 3])).toBeCloseTo(1, 12);
  });

  it("summarizes distributions and ignores missing values", () => {
    expect(stat([])).toBeNull();
    expect(stat([null, 2, 4, undefined, 6])).toMatchObject({ mean: 4, p50: 4, min: 2, max: 6, n: 3 });
  });
});
