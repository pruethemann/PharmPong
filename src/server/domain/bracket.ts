import { buildKnockoutTemplates } from "./draw";
import { isDecidedStatus } from "./match-state";
import type { MatchStatus, MatchView, Qualifiers, Slot } from "./types";

export const KNOCKOUT_CODES = ["QF1", "QF2", "QF3", "QF4", "SF1", "SF2", "F"] as const;
export type KnockoutCode = (typeof KNOCKOUT_CODES)[number];
export type QuarterfinalCode = "QF1" | "QF2" | "QF3" | "QF4";

export type SlotPair = { home: string | null; away: string | null };

const TEMPLATES = buildKnockoutTemplates();

/** QF1 A1–B2, QF2 B1–A2, QF3 C1–D2, QF4 D1–C2. */
export function resolveQuarterfinals(
  q: Qualifiers,
): Record<QuarterfinalCode, { home: string; away: string }> {
  return {
    QF1: { home: q.A1, away: q.B2 },
    QF2: { home: q.B1, away: q.A2 },
    QF3: { home: q.C1, away: q.D2 },
    QF4: { home: q.D1, away: q.C2 },
  };
}

function sourcesOf(code: string): string[] {
  const t = TEMPLATES.find((x) => x.code === code);
  return t ? [t.homeSource ?? "", t.awaySource ?? ""] : [];
}

/** Does knockout match `ko` take a team (directly) from `source` code? */
function feedsFrom(ko: string, sourceCode: string): boolean {
  const group = /^([A-D])-\d+$/.exec(sourceCode)?.[1];
  return sourcesOf(ko).some((s) =>
    group ? s.startsWith(group) && !s.startsWith("W:") : s === `W:${sourceCode}`,
  );
}

/**
 * All knockout matches whose participants depend on the outcome of `code`
 * (transitively), in bracket order. Group codes affect the quarterfinals
 * seeded from that group.
 */
export function downstreamCodes(code: string): string[] {
  const found = new Set<string>();
  const frontier = [code];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    for (const ko of KNOCKOUT_CODES) {
      if (!found.has(ko) && feedsFrom(ko, current)) {
        found.add(ko);
        frontier.push(ko);
      }
    }
  }
  return KNOCKOUT_CODES.filter((c) => found.has(c));
}

/**
 * Winner of feeder `code`, but only when that feeder is decided AND was played
 * between exactly the teams it should hold (`expected`) and the recorded winner
 * is one of them. A feeder decided between stale participants (e.g. after a
 * group correction changed a qualifier) yields null, so the damage propagates.
 */
function validWinnerOf(matches: MatchView[], code: string, expected: SlotPair | undefined): string | null {
  const m = matches.find((x) => x.code === code);
  if (!m || !isDecidedStatus(m.status) || !m.result || !expected) return null;
  if (expected.home === null || expected.away === null) return null;
  if (m.homeTeamId !== expected.home || m.awayTeamId !== expected.away) return null;
  const w = m.result.winnerTeamId;
  return w === expected.home || w === expected.away ? w : null;
}

/**
 * The teams each knockout slot should hold given the current results.
 * Computed in bracket order; a feeder's winner counts only when the feeder's
 * own participants match its expected slots (see validWinnerOf).
 */
export function expectedKnockoutSlots(
  matches: MatchView[],
  qualifiers: Qualifiers | null,
): Record<KnockoutCode, SlotPair> {
  const qf = qualifiers ? resolveQuarterfinals(qualifiers) : null;
  const out = {} as Record<KnockoutCode, SlotPair>;
  // Semifinal and final sources are always "W:<code>"; TEMPLATES are in bracket order.
  const resolveSource = (source: string | null): string | null => {
    if (!source?.startsWith("W:")) return null;
    const feeder = source.slice(2) as KnockoutCode;
    return validWinnerOf(matches, feeder, out[feeder]);
  };
  for (const t of TEMPLATES) {
    const code = t.code as KnockoutCode;
    if (code.startsWith("QF")) {
      const pair = qf?.[code as QuarterfinalCode];
      out[code] = { home: pair?.home ?? null, away: pair?.away ?? null };
    } else {
      out[code] = { home: resolveSource(t.homeSource), away: resolveSource(t.awaySource) };
    }
  }
  return out;
}

export type SlotDiff = {
  code: string;
  slot: Slot;
  current: string | null;
  expected: string | null;
  status: MatchStatus;
};

/** Knockout slots whose current team differs from the expected one. */
export function diffKnockoutSlots(
  matches: MatchView[],
  expected: Partial<Record<string, SlotPair>>,
): SlotDiff[] {
  const diffs: SlotDiff[] = [];
  const ordered = [...matches]
    .filter((m) => m.stage === "KNOCKOUT" && expected[m.code])
    .sort((a, b) => a.orderIndex - b.orderIndex);
  for (const m of ordered) {
    const exp = expected[m.code]!;
    if (m.homeTeamId !== exp.home) {
      diffs.push({ code: m.code, slot: "HOME", current: m.homeTeamId, expected: exp.home, status: m.status });
    }
    if (m.awayTeamId !== exp.away) {
      diffs.push({ code: m.code, slot: "AWAY", current: m.awayTeamId, expected: exp.away, status: m.status });
    }
  }
  return diffs;
}
