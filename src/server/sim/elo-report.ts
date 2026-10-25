// Aggregates the PharmaElo Monte Carlo runs into the validation report
// (docs/elo-mode/rating-validation.md). Pure: scripts/elo-validation.ts does the file I/O.
import { DEFAULT_ELO_PARAMS, ELO_ALGORITHM_VERSION } from "@/server/domain/elo/config";
import { PHARMA_ELO_V1, type RatingEngine } from "@/server/domain/elo/engine";
import { replaySession, projectionsOf, type ReplayEntry } from "@/server/domain/elo/replay";
import type { EloParams } from "@/server/domain/elo/types";
import { mulberry32 } from "@/server/domain/rng";
import {
  analyzeRun,
  BASE_CONFIG,
  showcase,
  simulateEvent,
  type Pattern,
  type RunMetrics,
  type SimConfig,
  type Tier,
} from "./elo-montecarlo";

export type ScenarioDef = { key: string; title: string; config: SimConfig };

const event = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...BASE_CONFIG, pattern: "event", ...patch });
const pattern = (p: Pattern): SimConfig => ({ ...BASE_CONFIG, pattern: p });

export const SCENARIOS: ScenarioDef[] = [
  { key: "event", title: "Apéro (realistic event)", config: event() },
  { key: "casual", title: "Casual: 1–2 matches each", config: pattern("casual") },
  { key: "moderate", title: "Moderate: 3–5 matches each", config: pattern("moderate") },
  { key: "active", title: "Highly active: 6–10 matches each", config: pattern("active") },
  { key: "mixed", title: "Mixed: 25% never … 25% very active", config: pattern("mixed") },
  {
    key: "sizeAdvantage",
    title: "Apéro, larger teams really stronger (+10 per extra player)",
    config: event({ sizeAdvantage: 10 }),
  },
  {
    key: "highLuck",
    title: "Apéro, more luck than the model assumes (true scale 200)",
    config: event({ trueScale: 200 }),
  },
];

export type Stat = {
  mean: number;
  p5: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  n: number;
};

export function stat(values: readonly (number | null | undefined)[]): Stat | null {
  const xs = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const q = (p: number) => {
    const i = (xs.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
  };
  return {
    mean: xs.reduce((s, x) => s + x, 0) / xs.length,
    p5: q(0.05),
    p50: q(0.5),
    p95: q(0.95),
    min: xs[0],
    max: xs[xs.length - 1],
    n: xs.length,
  };
}

export function rate(values: readonly (boolean | null | undefined)[]): number | null {
  const xs = values.filter((v): v is boolean => typeof v === "boolean");
  return xs.length ? xs.filter(Boolean).length / xs.length : null;
}

const TIERS: Tier[] = ["never", "casual", "moderate", "active"];

export type ScenarioSummary = {
  key: string;
  title: string;
  seeds: number;
  matches: Record<keyof RunMetrics["matches"], Stat | null>;
  repeatRate: Stat | null;
  players: Record<keyof RunMetrics["players"], Stat | null>;
  ratingMin: Stat | null;
  ratingMax: Stat | null;
  ratingSd: Stat | null;
  conservationMax: number;
  spearmanEligible: Stat | null;
  spearmanAll: Stat | null;
  stability75: Stat | null;
  leaderKept: number | null;
  champion: {
    none: number;
    coChampions: number | null;
    bestSkill: number | null;
    top3Skill: number | null;
    topRatedProvisional: number | null;
    soloRate: number | null;
    soloEligibleShare: number | null;
    tierRate: Record<Tier, number> | null;
    tierEligibleShare: Record<Tier, number> | null;
  };
  absDeltaBySize: (Stat | null)[];
  largerTeamWinRate: Stat | null;
  corrTeamSizeRating: Stat | null;
  corrGamesRating: Stat | null;
  corrGamesAbsDeviation: Stat | null;
  correction: {
    downstreamChanged: Stat | null;
    maxFinalShift: Stat | null;
    naiveError: Stat | null;
    reproducible: number | null;
  };
};

export function summarize(def: ScenarioDef, runs: readonly RunMetrics[]): ScenarioSummary {
  const pick = <T>(f: (m: RunMetrics) => T) => runs.map(f);
  const matchKeys = Object.keys(runs[0].matches) as (keyof RunMetrics["matches"])[];
  const playerKeys = Object.keys(runs[0].players) as (keyof RunMetrics["players"])[];
  const withChampion = runs.filter((r) => r.champion.count > 0);
  const tierShare = (f: (r: RunMetrics) => Record<Tier, number> | null) => {
    const rows = withChampion.map(f).filter((x): x is Record<Tier, number> => x !== null);
    return rows.length
      ? (Object.fromEntries(
          TIERS.map((t) => [t, rows.reduce((s, r) => s + r[t], 0) / rows.length]),
        ) as Record<Tier, number>)
      : null;
  };
  return {
    key: def.key,
    title: def.title,
    seeds: runs.length,
    matches: Object.fromEntries(
      matchKeys.map((k) => [k, stat(pick((m) => m.matches[k]))]),
    ) as ScenarioSummary["matches"],
    repeatRate: stat(pick((m) => m.repeatRate)),
    players: Object.fromEntries(
      playerKeys.map((k) => [k, stat(pick((m) => m.players[k]))]),
    ) as ScenarioSummary["players"],
    ratingMin: stat(pick((m) => m.rating?.min)),
    ratingMax: stat(pick((m) => m.rating?.max)),
    ratingSd: stat(pick((m) => m.rating?.sd)),
    conservationMax: Math.max(...pick((m) => m.conservationError)),
    spearmanEligible: stat(pick((m) => m.spearmanEligible)),
    spearmanAll: stat(pick((m) => m.spearmanAll)),
    stability75: stat(pick((m) => m.stability.spearman75)),
    leaderKept: rate(pick((m) => m.stability.leaderKept)),
    champion: {
      none: runs.filter((r) => r.champion.count === 0).length / runs.length,
      coChampions: rate(withChampion.map((r) => r.champion.count > 1)),
      bestSkill: rate(withChampion.map((r) => r.champion.trueSkillRank === 1)),
      top3Skill: rate(withChampion.map((r) => (r.champion.trueSkillRank ?? 99) <= 3)),
      topRatedProvisional: rate(pick((m) => (m.players.rated ? m.champion.topRatedProvisional : null))),
      soloRate: rate(withChampion.map((r) => r.champion.style === "solo")),
      soloEligibleShare: stat(withChampion.map((r) => r.eligibleShare.solo))?.mean ?? null,
      tierRate: withChampion.length
        ? (Object.fromEntries(
            TIERS.map((t) => [
              t,
              withChampion.filter((r) => r.champion.tier === t).length / withChampion.length,
            ]),
          ) as Record<Tier, number>)
        : null,
      tierEligibleShare: tierShare((r) => r.eligibleShare.byTier),
    },
    absDeltaBySize: [0, 1, 2, 3].map((i) => stat(pick((m) => m.sizeEffect.meanAbsDeltaBySize[i]))),
    largerTeamWinRate: stat(pick((m) => m.sizeEffect.largerTeamWinRate)),
    corrTeamSizeRating: stat(pick((m) => m.sizeEffect.corrTeamSizeRating)),
    corrGamesRating: stat(pick((m) => m.activity.corrGamesRating)),
    corrGamesAbsDeviation: stat(pick((m) => m.activity.corrGamesAbsDeviation)),
    correction: {
      downstreamChanged: stat(pick((m) => m.correction?.downstreamChanged)),
      maxFinalShift: stat(pick((m) => m.correction?.maxFinalShift)),
      naiveError: stat(pick((m) => m.correction?.naiveError)),
      reproducible: rate(pick((m) => m.correction?.reproducible)),
    },
  };
}

export function runScenario(
  def: ScenarioDef,
  seeds: number,
  firstSeed = 1,
  engine: RatingEngine = PHARMA_ELO_V1,
): ScenarioSummary {
  const runs = Array.from({ length: seeds }, (_, i) =>
    analyzeRun(simulateEvent(def.config, firstSeed + i), engine),
  );
  return summarize(def, runs);
}

// ─── What-if variants (input for tuning decisions; the product uses the spec rules) ────────

/**
 * Simulation-only variant, NOT part of the product: halves the transfer whenever one side is a
 * single player. It would change spec example B (solo +6 / four losers −1.5 instead of +12 / −3).
 */
export const SOLO_HALF_ENGINE: RatingEngine = {
  version: "what-if-solo-half",
  calculate: (input) =>
    PHARMA_ELO_V1.calculate({
      ...input,
      multiplier:
        Math.min(input.sideA.length, input.sideB.length) === 1 ? input.multiplier * 0.5 : input.multiplier,
    }),
};

export type WhatIf = { key: string; title: string; patch: Partial<SimConfig>; engine?: RatingEngine };

export const WHAT_IFS: WhatIf[] = [
  { key: "baseline", title: "Spec rules (K 24, D 100, champion ≥ 3 games)", patch: {} },
  { key: "min5", title: "Champion needs ≥ 5 rated games", patch: { minGamesForChampion: 5 } },
  { key: "k16", title: "K = 16", patch: { params: { ...DEFAULT_ELO_PARAMS, kFactor: 16 } } },
  { key: "k32", title: "K = 32", patch: { params: { ...DEFAULT_ELO_PARAMS, kFactor: 32 } } },
  { key: "d200", title: "D = 200", patch: { params: { ...DEFAULT_ELO_PARAMS, ratingScale: 200 } } },
  {
    key: "soloHalf",
    title: "What-if only: solo matches transfer 50% (breaks spec example B)",
    patch: {},
    engine: SOLO_HALF_ENGINE,
  },
];

export type WhatIfRow = { key: string; title: string; pattern: Pattern; summary: ScenarioSummary };

export function whatIfStudy(
  seeds: number,
  patterns: readonly Pattern[] = ["event", "moderate"],
): WhatIfRow[] {
  return WHAT_IFS.flatMap((w) =>
    patterns.map((pattern) => {
      const def: ScenarioDef = {
        key: `${w.key}-${pattern}`,
        title: w.title,
        config: { ...BASE_CONFIG, pattern, ...w.patch },
      };
      return { key: w.key, title: w.title, pattern, summary: runScenario(def, seeds, 1, w.engine) };
    }),
  );
}

// ─── Anti-farming study ────────────────────────────────────────────────────

export type FarmingRow = {
  match: number;
  withSafeguard: number;
  withoutSafeguard: number;
  multiplier: number;
};

/**
 * A strong duo (true skill 140) repeatedly plays the same weak duo (70). Mean cumulative rating
 * gain of one strong player after each match, with the default safeguard and without it.
 */
export function farmingStudy(
  seeds: number,
  matches = 10,
  params: EloParams = DEFAULT_ELO_PARAMS,
): FarmingRow[] {
  const pWin = 1 / (1 + 10 ** ((70 - 140) / params.ratingScale));
  const totals = { on: new Array<number>(matches).fill(0), off: new Array<number>(matches).fill(0) };
  for (let seed = 1; seed <= seeds; seed++) {
    const rnd = mulberry32(seed);
    const entries: ReplayEntry[] = Array.from({ length: matches }, (_, i) => ({
      matchId: `f${i}`,
      sequence: i + 1,
      rated: true,
      winner: rnd() < pWin ? "A" : "B",
      sideA: ["strong1", "strong2"],
      sideB: ["weak1", "weak2"],
    }));
    for (const [key, multipliers] of [
      ["on", params.repeatMultipliers],
      ["off", [1]],
    ] as const) {
      for (let n = 1; n <= matches; n++) {
        const { state } = replaySession(entries.slice(0, n), { ...params, repeatMultipliers: multipliers });
        const strong =
          projectionsOf(state).find((p) => p.userId === "strong1")?.rating ?? params.initialRating;
        totals[key][n - 1] += strong - params.initialRating;
      }
    }
  }
  return totals.on.map((sum, i) => ({
    match: i + 1,
    withSafeguard: sum / seeds,
    withoutSafeguard: totals.off[i] / seeds,
    multiplier: params.repeatMultipliers[Math.min(i, params.repeatMultipliers.length - 1)],
  }));
}

// ─── Report ────────────────────────────────────────────────────────────────

export type ValidationReport = {
  generatedAt: string;
  seeds: number;
  algorithmVersion: string;
  params: EloParams;
  minGamesForChampion: number;
  scenarios: ScenarioSummary[];
  whatIfs: WhatIfRow[];
  farming: FarmingRow[];
  showcase: {
    seed: number;
    matches: number;
    leaderboard: ReturnType<typeof showcase>["ranked"];
    achievements: ReturnType<typeof showcase>["achievements"];
    metrics: RunMetrics;
  };
};

export function buildReport(seeds: number, generatedAt: string, showcaseSeed = 7): ValidationReport {
  const run = simulateEvent(SCENARIOS[0].config, showcaseSeed);
  const sc = showcase(run);
  return {
    generatedAt,
    seeds,
    algorithmVersion: ELO_ALGORITHM_VERSION,
    params: DEFAULT_ELO_PARAMS,
    minGamesForChampion: BASE_CONFIG.minGamesForChampion,
    scenarios: SCENARIOS.map((d) => runScenario(d, seeds)),
    whatIfs: whatIfStudy(seeds),
    farming: farmingStudy(seeds),
    showcase: {
      seed: showcaseSeed,
      matches: run.entries.length,
      leaderboard: sc.ranked,
      achievements: sc.achievements,
      metrics: analyzeRun(run),
    },
  };
}

const f = (x: number | null | undefined, digits = 1) => (typeof x === "number" ? x.toFixed(digits) : "–");
const pct = (x: number | null | undefined) => (typeof x === "number" ? `${(100 * x).toFixed(0)}%` : "–");
const span = (s: Stat | null, digits = 1) =>
  s ? `${f(s.mean, digits)} (${f(s.p5, digits)}–${f(s.p95, digits)})` : "–";

function table(header: string[], rows: (string | number)[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

/** The generated section of rating-validation.md (numbers only; interpretation is written by hand). */
export function reportMarkdown(r: ValidationReport): string {
  const S = r.scenarios;
  const main = S.slice(0, 5);
  const out: string[] = [];
  out.push(
    `_Generated ${r.generatedAt} by \`pnpm elo:validate\`: ${r.seeds} seeds per scenario, engine \`${r.algorithmVersion}\`, ` +
      `K = ${r.params.kFactor}, D = ${r.params.ratingScale}, start ${r.params.initialRating}, ` +
      `repeat multipliers [${r.params.repeatMultipliers.join(", ")}], champion minimum ${r.minGamesForChampion} rated games. ` +
      `Values are mean (5th–95th percentile) over the seeds._`,
  );

  out.push("### Volume and participation");
  out.push(
    table(
      [
        "Scenario",
        "Completed matches",
        "Players with a rated game",
        "Eligible (≥ min games)",
        "Provisional",
        "Never played",
        "Repeat pairings",
        "½-rated / unrated repeats per event",
      ],
      main.map((s) => [
        s.title,
        span(s.matches.completed, 0),
        span(s.players.rated, 0),
        span(s.players.eligible, 0),
        span(s.players.provisional, 0),
        span(s.players.neverPlayed, 0),
        pct(s.repeatRate?.mean),
        `${f(s.matches.partial?.mean, 2)} / ${f(s.matches.unratedRepeat?.mean, 2)}`,
      ]),
    ),
  );

  out.push("### Event realism (apéro scenario)");
  const ev = S[0];
  out.push(
    table(
      ["Metric", "Value"],
      [
        ["Matches started / completed", `${span(ev.matches.started, 0)} / ${span(ev.matches.completed, 0)}`],
        ["Friendlies", span(ev.matches.friendly, 1)],
        [
          "Disputes resolved later (out of order) / voided",
          `${span(ev.matches.disputeResolved, 1)} / ${span(ev.matches.voided, 1)}`,
        ],
        ["Cancelled matches", span(ev.matches.cancelled, 1)],
        ["Confirmed in a different order than started", span(ev.matches.outOfOrder, 1)],
        [
          "Max. tables in use at the same time",
          `${f(ev.matches.maxConcurrent?.min, 0)}–${f(ev.matches.maxConcurrent?.max, 0)}`,
        ],
      ],
    ),
  );

  out.push("### Rating distribution and conservation");
  out.push(
    table(
      [
        "Scenario",
        "Lowest rating",
        "Highest rating",
        "SD of ratings",
        "Extremes over all seeds",
        "Max. conservation error",
      ],
      S.map((s) => [
        s.title,
        span(s.ratingMin),
        span(s.ratingMax),
        span(s.ratingSd),
        `${f(s.ratingMin?.min)} … ${f(s.ratingMax?.max)}`,
        s.conservationMax.toExponential(1),
      ]),
    ),
  );

  out.push("### Accuracy, stability and the champion");
  out.push(
    table(
      [
        "Scenario",
        "Spearman rating vs. true skill (eligible)",
        "Ranking at 75% vs. final",
        "Leader at 75% still champion",
        "No champion",
        "Champion = truly best",
        "Champion in true top 3",
        "Top rated player is provisional",
      ],
      S.map((s) => [
        s.title,
        span(s.spearmanEligible, 2),
        span(s.stability75, 2),
        pct(s.leaderKept),
        pct(s.champion.none),
        pct(s.champion.bestSkill),
        pct(s.champion.top3Skill),
        pct(s.champion.topRatedProvisional),
      ]),
    ),
  );

  out.push("### Team size");
  out.push(
    table(
      [
        "Scenario",
        "Mean abs(Δ) per player at team size 1 / 2 / 3 / 4",
        "Larger team wins (uneven matches)",
        "Corr. avg team size vs. rating",
      ],
      [S[0], S[5], S[6]].map((s) => [
        s.title,
        s.absDeltaBySize.map((x) => f(x?.mean, 2)).join(" / "),
        pct(s.largerTeamWinRate?.mean),
        f(s.corrTeamSizeRating?.mean, 2),
      ]),
    ),
  );

  out.push("### Participation frequency and play style");
  out.push(
    table(
      [
        "Scenario",
        "Corr. games vs. rating",
        "Corr. games vs. abs(rating − 100)",
        "Champion plays solo",
        "Solo players among eligible",
      ],
      S.map((s) => [
        s.title,
        f(s.corrGamesRating?.mean, 2),
        f(s.corrGamesAbsDeviation?.mean, 2),
        pct(s.champion.soloRate),
        pct(s.champion.soloEligibleShare),
      ]),
    ),
  );
  for (const s of [S[0], S[4]]) {
    if (!s.champion.tierRate || !s.champion.tierEligibleShare) continue;
    out.push(`Champion by participation tier, ${s.title}:`);
    out.push(
      table(
        ["Tier", "Share of champions", "Share of eligible players"],
        TIERS.filter((t) => t !== "never").map((t) => [
          t,
          pct(s.champion.tierRate![t]),
          pct(s.champion.tierEligibleShare![t]),
        ]),
      ),
    );
  }

  out.push("### Corrections and replay (earliest rated result flipped, full replay)");
  out.push(
    table(
      [
        "Scenario",
        "Later matches whose calculation changed",
        "Largest final rating shift",
        "Error of a naive one-match fix",
        "Replay reproducible",
      ],
      main.map((s) => [
        s.title,
        span(s.correction.downstreamChanged, 1),
        span(s.correction.maxFinalShift, 2),
        span(s.correction.naiveError, 2),
        pct(s.correction.reproducible),
      ]),
    ),
  );

  out.push("### What-if variants (same seeds; input for tuning, not the product rules)");
  out.push(
    table(
      [
        "Variant",
        "Pattern",
        "Eligible players",
        "Spearman (eligible)",
        "Champion = truly best",
        "Champion in true top 3",
        "No champion",
        "Champion plays solo / solo among eligible",
        "Lowest … highest rating (p5 … p95)",
      ],
      r.whatIfs.map((w) => [
        w.title,
        w.pattern,
        span(w.summary.players.eligible, 0),
        span(w.summary.spearmanEligible, 2),
        pct(w.summary.champion.bestSkill),
        pct(w.summary.champion.top3Skill),
        pct(w.summary.champion.none),
        `${pct(w.summary.champion.soloRate)} / ${pct(w.summary.champion.soloEligibleShare)}`,
        `${f(w.summary.ratingMin?.p5)} … ${f(w.summary.ratingMax?.p95)}`,
      ]),
    ),
  );

  out.push("### Anti-farming safeguard (strong duo, true skill 140, vs. the same weak duo, 70)");
  out.push(
    table(
      ["Meeting", "Multiplier", "Cumulative gain per strong player, with safeguard", "Without safeguard"],
      r.farming.map((row) => [
        row.match,
        row.multiplier,
        f(row.withSafeguard, 2),
        f(row.withoutSafeguard, 2),
      ]),
    ),
  );

  const sc = r.showcase;
  out.push(`### Showcase: one simulated apéro (seed ${sc.seed}, ${sc.matches} confirmed matches)`);
  const skillRank = new Map(
    [...sc.leaderboard].sort((a, b) => b.skill - a.skill).map((p, i) => [p.userId, i + 1] as const),
  );
  out.push(
    table(
      ["Rank", "Player", "Elo", "Δ", "Rated games", "W–L", "Status", "True-skill rank", "Style"],
      sc.leaderboard
        .slice(0, 12)
        .map((p) => [
          p.rank,
          p.userId,
          f(p.rating, 1),
          `${p.ratingChange >= 0 ? "+" : ""}${f(p.ratingChange, 1)}`,
          p.gamesPlayed,
          `${p.wins}–${p.losses}`,
          p.provisional ? "provisional" : "eligible",
          skillRank.get(p.userId)!,
          p.style,
        ]),
    ),
  );
  const a = sc.achievements;
  out.push(
    table(
      ["Achievement", "Holder", "Value"],
      [
        [
          "Most Active",
          a.mostActive?.userIds.join(", ") ?? "–",
          a.mostActive ? `${a.mostActive.value} matches` : "–",
        ],
        [
          "Biggest Upset",
          a.biggestUpset?.userIds.join(", ") ?? "–",
          a.biggestUpset ? `${pct(a.biggestUpset.value)} win probability` : "–",
        ],
        [
          "Best Comeback",
          a.bestComeback?.userIds.join(", ") ?? "–",
          a.bestComeback ? `+${f(a.bestComeback.value, 1)} Elo` : "–",
        ],
      ],
    ),
  );
  return out.join("\n\n");
}
