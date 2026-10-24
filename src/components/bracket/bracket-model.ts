// Pure bracket layout: which knockout match sits in which column and row.
import type { LiveMatch } from "@/lib/live-types";

export type BracketColumns = { quarter: LiveMatch[]; semi: LiveMatch[]; final: LiveMatch[] };

const winnerOf = (source: string | null): string | null => {
  const m = source ? /^W:(.+)$/.exec(source) : null;
  return m ? m[1] : null;
};

/**
 * Orders the knockout matches so that every match sits between the two matches
 * feeding it (QF1, QF3 → SF1; QF2, QF4 → SF2 → F), derived from the persisted
 * slot sources. Falls back to code order if the relationships are missing.
 */
export function bracketColumns(matches: readonly LiveMatch[]): BracketColumns | null {
  const ko = matches.filter((m) => m.stage === "KNOCKOUT" && m.status !== "CANCELLED");
  if (ko.length === 0) return null;
  const byCode = new Map(ko.map((m) => [m.code, m]));
  const byRound = (r: number) =>
    ko
      .filter((m) => m.round === r)
      .sort((a, b) => a.orderIndex - b.orderIndex || a.code.localeCompare(b.code));

  const final = byRound(3);
  const feeders = (m: LiveMatch | undefined): LiveMatch[] =>
    m
      ? [winnerOf(m.homeSource), winnerOf(m.awaySource)]
          .map((c) => (c ? byCode.get(c) : undefined))
          .filter((x): x is LiveMatch => !!x)
      : [];

  let semi = feeders(final[0]);
  if (semi.length !== 2) semi = byRound(2);
  let quarter = semi.flatMap(feeders);
  if (quarter.length !== 4) quarter = byRound(1);
  return { quarter, semi, final };
}

/** Short node code: "VF1", "HF2", "Final". */
export function shortCode(code: string): string {
  if (code === "F") return "Final";
  return code.replace(/^QF/, "VF").replace(/^SF/, "HF");
}
