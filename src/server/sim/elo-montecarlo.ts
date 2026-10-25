// Monte Carlo validation of PharmaElo (spec §11.5). Pure and seeded: no database, no clock.
// Every player has a hidden "true skill" on the Elo scale; outcomes are drawn from it and the
// rating system only ever sees results, exactly as at the real event. Used by
// scripts/elo-validation.ts (report) and by its unit test.
import { computeAchievements, type Achievements } from "@/server/domain/elo/achievements";
import { DEFAULT_ELO_PARAMS, DEFAULT_SESSION_SETTINGS } from "@/server/domain/elo/config";
import { PHARMA_ELO_V1, type RatingEngine } from "@/server/domain/elo/engine";
import { championsOf, rankPlayers, type RankedPlayer } from "@/server/domain/elo/ranking";
import {
  conservationError,
  projectionDigest,
  projectionsOf,
  replaySession,
  type ReplayEntry,
} from "@/server/domain/elo/replay";
import type { EloParams, Side } from "@/server/domain/elo/types";
import { mulberry32 } from "@/server/domain/rng";

export type Pattern = "casual" | "moderate" | "active" | "mixed" | "event";
export type Tier = "never" | "casual" | "moderate" | "active";
export type Style = "solo" | "team";

export type SimConfig = {
  pattern: Pattern;
  players: number;
  tables: number;
  /** Standard deviation of true skill around 100. */
  skillSd: number;
  /** Real advantage (Elo points) per extra player on a side; 0 = the two-throws rule works. */
  sizeAdvantage: number;
  /** Scale of the true outcome model; equal to D means the rating model is well specified. */
  trueScale: number;
  friendlyRate: number;
  /** Chance that the last finished pairing immediately asks for a rematch. */
  rematchRate: number;
  disputeRate: number;
  /** Share of disputes that end voided (the rest are resolved later, out of order). */
  disputeVoidShare: number;
  cancelRate: number;
  /** Share of players who like to play alone (high-variance style). */
  soloShare: number;
  /** Length of the "event" pattern in minutes (players arrive and leave). */
  eventMinutes: number;
  params: EloParams;
  minGamesForChampion: number;
};

export const BASE_CONFIG: SimConfig = {
  pattern: "event",
  players: 24,
  tables: 2,
  skillSd: 30,
  sizeAdvantage: 0,
  trueScale: DEFAULT_ELO_PARAMS.ratingScale,
  friendlyRate: 0.08,
  rematchRate: 0.25,
  disputeRate: 0.05,
  disputeVoidShare: 0.3,
  cancelRate: 0.03,
  soloShare: 0.2,
  eventMinutes: 360,
  params: DEFAULT_ELO_PARAMS,
  minGamesForChampion: DEFAULT_SESSION_SETTINGS.minGamesForChampion,
};

export type SimPlayer = {
  id: string;
  skill: number;
  tier: Tier;
  style: Style;
  /** Pattern scenarios: maximum number of matches. */
  quota: number;
  /** Event scenario: selection weight and presence window (minutes). */
  weight: number;
  arrival: number;
  departure: number;
};

export type SimOutcome = "COMPLETED" | "DISPUTE_RESOLVED" | "VOIDED" | "CANCELLED";

export type SimMatch = {
  id: string;
  table: number;
  start: number;
  end: number;
  sideA: string[];
  sideB: string[];
  winner: Side;
  rated: boolean;
  outcome: SimOutcome;
  /** When the result became final (null: voided or cancelled). Decides the sequence. */
  confirmAt: number | null;
  trueExpectedA: number;
};

export type SimRun = {
  seed: number;
  config: SimConfig;
  players: SimPlayer[];
  matches: SimMatch[];
  /** Confirmed matches in confirmation order, as the server would replay them. */
  entries: ReplayEntry[];
};

type Rand = () => number;

function normal(rnd: Rand): number {
  const u = 1 - rnd();
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const intIn = (rnd: Rand, min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rnd: Rand): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let x = rnd() * total;
  for (const t of items) {
    x -= weight(t);
    if (x < 0) return t;
  }
  return items[items.length - 1];
}

const TIER_WEIGHT: Record<Tier, number> = { never: 0, casual: 1, moderate: 3, active: 6 };
const QUOTA: Record<Tier, [number, number]> = {
  never: [0, 0],
  casual: [1, 2],
  moderate: [3, 5],
  active: [6, 10],
};

function tierFor(pattern: Pattern, index: number, count: number): Tier {
  if (pattern === "casual" || pattern === "moderate" || pattern === "active") return pattern;
  const share = index / count;
  if (pattern === "mixed")
    return share < 0.25 ? "never" : share < 0.5 ? "casual" : share < 0.75 ? "moderate" : "active";
  // event: 15% never, 25% casual, 35% moderate, 25% active
  return share < 0.15 ? "never" : share < 0.4 ? "casual" : share < 0.75 ? "moderate" : "active";
}

function makePlayers(cfg: SimConfig, rnd: Rand): SimPlayer[] {
  return Array.from({ length: cfg.players }, (_, i) => {
    const tier = tierFor(cfg.pattern, i, cfg.players);
    const arrival = rnd() * 90;
    const departure =
      tier === "casual"
        ? arrival + 60 + rnd() * 90
        : Math.min(cfg.eventMinutes, 180 + rnd() * (cfg.eventMinutes - 180));
    return {
      id: `p${String(i + 1).padStart(2, "0")}`,
      skill: 100 + cfg.skillSd * normal(rnd),
      tier,
      style: rnd() < cfg.soloShare ? "solo" : "team",
      quota: intIn(rnd, ...QUOTA[tier]),
      weight: TIER_WEIGHT[tier],
      arrival,
      departure,
    };
  });
}

const SIZE_WEIGHTS: ReadonlyArray<[number, number]> = [
  [1, 0.15],
  [2, 0.5],
  [3, 0.2],
  [4, 0.15],
];

function teamSize(rnd: Rand): number {
  return pickWeighted(SIZE_WEIGHTS, ([, w]) => w, rnd)[0];
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Plays one social event (or one participation pattern) on the tables. */
export function simulateEvent(cfg: SimConfig, seed: number): SimRun {
  const rnd = mulberry32(seed);
  const players = makePlayers(cfg, rnd);
  const byId = new Map(players.map((p) => [p.id, p]));
  const busyUntil = new Map(players.map((p) => [p.id, 0]));
  const started = new Map(players.map((p) => [p.id, 0]));
  const tableFree = Array.from({ length: cfg.tables }, () => 0);
  const timed = cfg.pattern === "event";
  const horizon = timed ? cfg.eventMinutes : Infinity;
  const matches: SimMatch[] = [];
  /** Pairings that asked for a revenge game right away (they skip the rest pause). */
  const rematchQueue: { a: string[]; b: string[] }[] = [];

  const present = (p: SimPlayer, t: number) =>
    timed ? p.weight > 0 && p.arrival <= t && t < p.departure : started.get(p.id)! < p.quota;
  const available = (t: number) => players.filter((p) => busyUntil.get(p.id)! <= t && present(p, t));
  const weightOf = (p: SimPlayer) => (timed ? p.weight : p.quota - started.get(p.id)!);
  const nextChange = (t: number): number | null => {
    const times = players
      .flatMap((p) => [busyUntil.get(p.id)!, timed ? p.arrival : -1])
      .filter((x) => x > t && x < horizon);
    return times.length ? Math.min(...times) : null;
  };

  for (let guard = 0; guard < 20_000; guard++) {
    let table = 0;
    for (let i = 1; i < tableFree.length; i++) if (tableFree[i] < tableFree[table]) table = i;
    const t = tableFree[table];
    if (!Number.isFinite(t) || t >= horizon - 10) break;
    const pool = available(t);
    if (pool.length < 2) {
      const next = nextChange(t);
      tableFree[table] = next ?? Infinity;
      continue;
    }

    // Roster: a queued revenge game of an identical pairing, or fresh temporary teams. Each side
    // has a captain; solo-style captains usually play alone, team slots prefer team-style players.
    let a: string[];
    let b: string[];
    const free = new Set(pool.map((p) => p.id));
    const queued = rematchQueue.findIndex((r) => [...r.a, ...r.b].every((id) => free.has(id)));
    if (queued >= 0) {
      const r = rematchQueue.splice(queued, 1)[0];
      [a, b] = rnd() < 0.5 ? [r.a, r.b] : [r.b, r.a];
    } else {
      const remaining = [...pool];
      const take = (prefer?: (p: SimPlayer) => boolean) => {
        const preferred = prefer ? remaining.filter(prefer) : remaining;
        const p = pickWeighted(preferred.length ? preferred : remaining, weightOf, rnd);
        remaining.splice(remaining.indexOf(p), 1);
        return p;
      };
      const captainA = take();
      const captainB = take();
      let nA = captainA.style === "solo" && rnd() < 0.8 ? 1 : teamSize(rnd);
      let nB = captainB.style === "solo" && rnd() < 0.8 ? 1 : teamSize(rnd);
      while (nA + nB > pool.length) {
        if (nA >= nB && nA > 1) nA--;
        else nB--;
      }
      a = [captainA.id];
      b = [captainB.id];
      const teamStyle = (p: SimPlayer) => p.style === "team";
      while (a.length < nA) a.push(take(teamStyle).id);
      while (b.length < nB) b.push(take(teamStyle).id);
    }

    const adv = cfg.sizeAdvantage * (a.length - b.length);
    const skillOf = (ids: string[]) => mean(ids.map((id) => byId.get(id)!.skill));
    const trueExpectedA = 1 / (1 + 10 ** ((skillOf(b) - skillOf(a) - adv) / cfg.trueScale));
    const winner: Side = rnd() < trueExpectedA ? "A" : "B";
    const duration = 6 + rnd() * 12;
    const roll = rnd();
    const rated = rnd() >= cfg.friendlyRate;
    let outcome: SimOutcome = "COMPLETED";
    let end = t + duration;
    let confirmAt: number | null = end + rnd() * 0.5;
    if (roll < cfg.cancelRate) {
      outcome = "CANCELLED";
      end = t + duration * rnd();
      confirmAt = null;
    } else if (roll < cfg.cancelRate + cfg.disputeRate) {
      if (rnd() < cfg.disputeVoidShare) {
        outcome = "VOIDED";
        confirmAt = null;
      } else {
        outcome = "DISPUTE_RESOLVED";
        confirmAt = end + 15 + rnd() * 25; // a referee decides later: out-of-order confirmation
      }
    }

    matches.push({
      id: `m${String(matches.length + 1).padStart(3, "0")}`,
      table,
      start: t,
      end,
      sideA: a,
      sideB: b,
      winner,
      rated,
      outcome,
      confirmAt,
      trueExpectedA,
    });
    const revenge = outcome !== "CANCELLED" && rnd() < cfg.rematchRate;
    if (revenge) {
      rematchQueue.push({ a, b });
      if (rematchQueue.length > 2) rematchQueue.shift();
    }
    for (const id of [...a, ...b]) {
      busyUntil.set(id, revenge ? end + 1 : end + 2 + rnd() * 8);
      started.set(id, started.get(id)! + 1);
    }
    tableFree[table] = end + 1;
  }

  const entries: ReplayEntry[] = matches
    .filter((m) => m.confirmAt !== null)
    .sort((x, y) => x.confirmAt! - y.confirmAt! || (x.id < y.id ? -1 : 1))
    .map((m, i) => ({
      matchId: m.id,
      sequence: i + 1,
      rated: m.rated,
      winner: m.winner,
      sideA: m.sideA,
      sideB: m.sideB,
    }));
  return { seed, config: cfg, players, matches, entries };
}

// ─── Statistics ────────────────────────────────────────────────────────────

function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export const spearman = (xs: readonly number[], ys: readonly number[]) => pearson(ranks(xs), ranks(ys));

// ─── Analysis of one run ───────────────────────────────────────────────────

export type RunMetrics = {
  matches: {
    started: number;
    completed: number;
    rated: number;
    effective: number;
    friendly: number;
    partial: number;
    unratedRepeat: number;
    disputeResolved: number;
    voided: number;
    cancelled: number;
    outOfOrder: number;
    maxConcurrent: number;
  };
  repeatRate: number | null;
  players: { total: number; neverPlayed: number; rated: number; provisional: number; eligible: number };
  rating: { min: number; max: number; mean: number; sd: number } | null;
  conservationError: number;
  spearmanEligible: number | null;
  spearmanAll: number | null;
  stability: { spearman75: number | null; leaderKept: boolean | null };
  champion: {
    count: number;
    trueSkillRank: number | null;
    topRatedProvisional: boolean;
    style: Style | null;
    tier: Tier | null;
  };
  eligibleShare: { solo: number | null; byTier: Record<Tier, number> | null };
  sizeEffect: {
    meanAbsDeltaBySize: (number | null)[];
    largerTeamWinRate: number | null;
    corrTeamSizeRating: number | null;
  };
  activity: { corrGamesRating: number | null; corrGamesAbsDeviation: number | null };
  correction: {
    downstreamChanged: number;
    maxFinalShift: number;
    naiveError: number;
    reproducible: boolean;
  } | null;
};

function maxConcurrent(matches: readonly SimMatch[]): number {
  const edges = matches.flatMap((m) => [
    [m.start, 1],
    [m.end, -1],
  ]);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of edges) best = Math.max(best, (cur += d));
  return best;
}

function rankedOf(run: SimRun, entries: readonly ReplayEntry[], engine: RatingEngine): RankedPlayer[] {
  const { state } = replaySession(entries, run.config.params, engine);
  return rankPlayers(projectionsOf(state), {
    minGamesForChampion: run.config.minGamesForChampion,
    initialRating: run.config.params.initialRating,
  });
}

/** Flip the earliest effective rated result and replay everything (spec §11.2 on simulated data). */
function correctionCheck(run: SimRun, engine: RatingEngine): RunMetrics["correction"] {
  const P = run.config.params;
  const base = replaySession(run.entries, P, engine);
  const target = base.steps.find((s) => s.effective);
  if (!target) return null;
  const flipped = run.entries.map((e) =>
    e.matchId === target.matchId ? { ...e, winner: e.winner === "A" ? ("B" as const) : ("A" as const) } : e,
  );
  const after = replaySession(flipped, P, engine);
  const again = replaySession(flipped, P, engine);
  const idx = base.steps.indexOf(target);
  let downstreamChanged = 0;
  for (let i = idx + 1; i < base.steps.length; i++) {
    if (JSON.stringify(base.steps[i].result) !== JSON.stringify(after.steps[i].result)) downstreamChanged++;
  }
  const finalBefore = new Map(projectionsOf(base.state).map((p) => [p.userId, p.rating]));
  const finalAfter = new Map(projectionsOf(after.state).map((p) => [p.userId, p.rating]));
  const oldDelta = new Map(target.result!.changes.map((c) => [c.userId, c.delta]));
  const newDelta = new Map(after.steps[idx].result!.changes.map((c) => [c.userId, c.delta]));
  let maxFinalShift = 0;
  let naiveError = 0;
  for (const [id, r] of finalAfter) {
    const before = finalBefore.get(id) ?? P.initialRating;
    maxFinalShift = Math.max(maxFinalShift, Math.abs(r - before));
    const naive = before - (oldDelta.get(id) ?? 0) + (newDelta.get(id) ?? 0);
    naiveError = Math.max(naiveError, Math.abs(naive - r));
  }
  return {
    downstreamChanged,
    maxFinalShift,
    naiveError,
    reproducible: projectionDigest(again.state) === projectionDigest(after.state),
  };
}

/** Metrics of one run. `engine` allows what-if variants; the product always uses PHARMA_ELO_V1. */
export function analyzeRun(run: SimRun, engine: RatingEngine = PHARMA_ELO_V1): RunMetrics {
  const P = run.config.params;
  const { state, steps } = replaySession(run.entries, P, engine);
  const projections = projectionsOf(state);
  const ranked = rankPlayers(projections, {
    minGamesForChampion: run.config.minGamesForChampion,
    initialRating: P.initialRating,
  });
  const byId = new Map(run.players.map((p) => [p.id, p]));
  const playedAny = new Set(run.entries.flatMap((e) => [...e.sideA, ...e.sideB]));
  const rated = steps.filter((s) => s.rated);
  const eligible = ranked.filter((r) => r.eligible);

  // Accuracy: does the rating order follow the hidden skill order?
  const skillsOf = (list: readonly RankedPlayer[]) => list.map((r) => byId.get(r.userId)!.skill);
  const ratingsOf = (list: readonly RankedPlayer[]) => list.map((r) => r.rating);

  // Stability: ranking after 75% of the confirmed matches vs the final ranking.
  const cut = Math.floor(run.entries.length * 0.75);
  const early = rankedOf(run, run.entries.slice(0, cut), engine);
  const finalById = new Map(ranked.map((r) => [r.userId, r.rating]));
  const common = early.filter((r) => finalById.has(r.userId));
  const earlyLeader = championsOf(early)[0]?.userId ?? null;
  const champions = championsOf(ranked);

  // Team size: per-player |Δ| by own team size; larger-team win rate in uneven matches.
  const bySize: number[][] = [[], [], [], []];
  let unevenMatches = 0;
  let largerWins = 0;
  const sizeSum = new Map<string, { n: number; total: number }>();
  for (const s of steps) {
    if (s.effective && s.result)
      for (const c of s.result.changes) bySize[c.teamSize - 1].push(Math.abs(c.delta));
    if (s.sideA.length !== s.sideB.length) {
      unevenMatches++;
      const larger: Side = s.sideA.length > s.sideB.length ? "A" : "B";
      if (s.winner === larger) largerWins++;
    }
    for (const [ids, size] of [
      [s.sideA, s.sideA.length],
      [s.sideB, s.sideB.length],
    ] as const) {
      for (const id of ids) {
        const cur = sizeSum.get(id) ?? { n: 0, total: 0 };
        sizeSum.set(id, { n: cur.n + 1, total: cur.total + size });
      }
    }
  }

  const tiers: Tier[] = ["never", "casual", "moderate", "active"];
  const champion = champions[0] ? byId.get(champions[0].userId)! : null;
  const skillRankAmongEligible = (id: string) =>
    1 + eligible.filter((r) => byId.get(r.userId)!.skill > byId.get(id)!.skill).length;
  const ratingValues = projections.map((p) => p.rating);
  const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

  return {
    matches: {
      started: run.matches.length,
      completed: run.entries.length,
      rated: rated.length,
      effective: steps.filter((s) => s.effective).length,
      friendly: steps.filter((s) => !s.rated).length,
      partial: rated.filter((s) => s.multiplier > 0 && s.multiplier < 1).length,
      unratedRepeat: rated.filter((s) => s.multiplier === 0).length,
      disputeResolved: run.matches.filter((m) => m.outcome === "DISPUTE_RESOLVED").length,
      voided: run.matches.filter((m) => m.outcome === "VOIDED").length,
      cancelled: run.matches.filter((m) => m.outcome === "CANCELLED").length,
      outOfOrder: run.entries.filter((e, i) => i > 0 && e.matchId < run.entries[i - 1].matchId).length,
      maxConcurrent: maxConcurrent(run.matches),
    },
    repeatRate: rated.length ? rated.filter((s) => s.priorCount > 0).length / rated.length : null,
    players: {
      total: run.players.length,
      neverPlayed: run.players.filter((p) => !playedAny.has(p.id)).length,
      rated: ranked.length,
      provisional: ranked.filter((r) => r.provisional).length,
      eligible: eligible.length,
    },
    rating: ratingValues.length
      ? {
          min: Math.min(...ratingValues),
          max: Math.max(...ratingValues),
          mean: mean(ratingValues),
          sd: sd(ratingValues),
        }
      : null,
    conservationError: conservationError(projections, P.initialRating),
    spearmanEligible: spearman(ratingsOf(eligible), skillsOf(eligible)),
    spearmanAll: spearman(ratingsOf(ranked), skillsOf(ranked)),
    stability: {
      spearman75: spearman(
        common.map((r) => r.rating),
        common.map((r) => finalById.get(r.userId)!),
      ),
      leaderKept: earlyLeader === null ? null : champions.some((c) => c.userId === earlyLeader),
    },
    champion: {
      count: champions.length,
      trueSkillRank: champion ? skillRankAmongEligible(champion.id) : null,
      topRatedProvisional: ranked[0]?.provisional ?? false,
      style: champion?.style ?? null,
      tier: champion?.tier ?? null,
    },
    eligibleShare: {
      solo: eligible.length
        ? eligible.filter((r) => byId.get(r.userId)!.style === "solo").length / eligible.length
        : null,
      byTier: eligible.length
        ? (Object.fromEntries(
            tiers.map((t) => [
              t,
              eligible.filter((r) => byId.get(r.userId)!.tier === t).length / eligible.length,
            ]),
          ) as Record<Tier, number>)
        : null,
    },
    sizeEffect: {
      meanAbsDeltaBySize: bySize.map((xs) => (xs.length ? mean(xs) : null)),
      largerTeamWinRate: unevenMatches ? largerWins / unevenMatches : null,
      corrTeamSizeRating: pearson(
        ranked.map((r) => sizeSum.get(r.userId)!.total / sizeSum.get(r.userId)!.n),
        ranked.map((r) => r.rating),
      ),
    },
    activity: {
      corrGamesRating: pearson(
        ranked.map((r) => r.gamesPlayed),
        ranked.map((r) => r.rating),
      ),
      corrGamesAbsDeviation: pearson(
        ranked.map((r) => r.gamesPlayed),
        ranked.map((r) => Math.abs(r.rating - P.initialRating)),
      ),
    },
    correction: correctionCheck(run, engine),
  };
}

/** Leaderboard and achievements of one run, for the showcase section of the report. */
export function showcase(run: SimRun): {
  ranked: (RankedPlayer & { skill: number; style: Style; tier: Tier })[];
  achievements: Achievements;
} {
  const { state, steps } = replaySession(run.entries, run.config.params);
  const byId = new Map(run.players.map((p) => [p.id, p]));
  const ranked = rankPlayers(projectionsOf(state), {
    minGamesForChampion: run.config.minGamesForChampion,
    initialRating: run.config.params.initialRating,
  }).map((r) => ({
    ...r,
    skill: byId.get(r.userId)!.skill,
    style: byId.get(r.userId)!.style,
    tier: byId.get(r.userId)!.tier,
  }));
  return { ranked, achievements: computeAchievements(steps, run.config.params.initialRating) };
}
