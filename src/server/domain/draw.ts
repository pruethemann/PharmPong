import { randomInt } from "node:crypto";
import { fail } from "./errors";
import { GROUP_NAMES, type DrawResult, type FixtureTemplate, type GroupName } from "./types";

export const TEAM_COUNT = 12;
export const TEAMS_PER_GROUP = 3;

/** rng(maxExclusive) returns an integer in [0, maxExclusive). */
export type Rng = (maxExclusive: number) => number;

/** Cryptographically secure RNG for the real draw. */
export const secureRng: Rng = (maxExclusive) => randomInt(maxExclusive);

/** Round r: [home position, away position] (1-based draw positions). */
const GROUP_ROUNDS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [3, 1],
  [2, 3],
];

const KO_ORDER_START = GROUP_NAMES.length * GROUP_ROUNDS.length + 1; // 13

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new RangeError(`rng returned ${j}, expected integer in [0, ${i}]`);
    }
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildGroupFixtures(groups: Record<GroupName, string[]>): FixtureTemplate[] {
  const fixtures: FixtureTemplate[] = [];
  GROUP_ROUNDS.forEach(([homePos, awayPos], r) => {
    GROUP_NAMES.forEach((group, g) => {
      const teams = groups[group];
      fixtures.push({
        code: `${group}-${r + 1}`,
        stage: "GROUP",
        round: r + 1,
        orderIndex: r * GROUP_NAMES.length + g + 1,
        group,
        homeTeamId: teams[homePos - 1],
        awayTeamId: teams[awayPos - 1],
        homeSource: null,
        awaySource: null,
        nextCode: null,
        nextSlot: null,
      });
    });
  });
  return fixtures;
}

export function buildKnockoutTemplates(): FixtureTemplate[] {
  const ko = (
    code: string,
    round: number,
    offset: number,
    homeSource: string,
    awaySource: string,
    nextCode: string | null,
    nextSlot: "HOME" | "AWAY" | null,
  ): FixtureTemplate => ({
    code,
    stage: "KNOCKOUT",
    round,
    orderIndex: KO_ORDER_START + offset,
    group: null,
    homeTeamId: null,
    awayTeamId: null,
    homeSource,
    awaySource,
    nextCode,
    nextSlot,
  });
  return [
    ko("QF1", 1, 0, "A1", "B2", "SF1", "HOME"),
    ko("QF2", 1, 1, "B1", "A2", "SF2", "HOME"),
    ko("QF3", 1, 2, "C1", "D2", "SF1", "AWAY"),
    ko("QF4", 1, 3, "D1", "C2", "SF2", "AWAY"),
    ko("SF1", 2, 4, "W:QF1", "W:QF3", "F", "HOME"),
    ko("SF2", 2, 5, "W:QF2", "W:QF4", "F", "AWAY"),
    ko("F", 3, 6, "W:SF1", "W:SF2", null, null),
  ];
}

/** Draws 12 teams into groups A–D (3 each) and builds all 19 fixtures. */
export function drawGroups(teamIds: string[], rng: Rng): DrawResult {
  if (teamIds.length !== TEAM_COUNT || new Set(teamIds).size !== TEAM_COUNT) {
    fail("WRONG_TEAM_COUNT", `Für die Auslosung braucht es genau ${TEAM_COUNT} Teams.`, {
      count: teamIds.length,
      distinct: new Set(teamIds).size,
    });
  }
  const shuffled = shuffle(teamIds, rng);
  const groups = Object.fromEntries(
    GROUP_NAMES.map((g, i) => [g, shuffled.slice(i * TEAMS_PER_GROUP, (i + 1) * TEAMS_PER_GROUP)]),
  ) as Record<GroupName, string[]>;
  return { groups, fixtures: [...buildGroupFixtures(groups), ...buildKnockoutTemplates()] };
}
