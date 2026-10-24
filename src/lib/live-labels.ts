// German labels for matches and bracket slot sources. Pure, usable on client and server.

const KO_NAMES: Record<string, string> = { QF: "Viertelfinal", SF: "Halbfinal" };

/**
 * "Gruppe A · Runde 1", "Viertelfinal 1", "Halbfinal 2", "Final".
 * Falls back to the code for unknown shapes.
 */
export function matchLabel(
  code: string,
  stage: "GROUP" | "KNOCKOUT",
  round: number,
  group: string | null,
): string {
  if (stage === "GROUP") {
    return group ? `Gruppe ${group} · Runde ${round}` : `Runde ${round}`;
  }
  if (code === "F") return "Final";
  const m = /^(QF|SF)(\d+)$/.exec(code);
  if (m) return `${KO_NAMES[m[1]]} ${m[2]}`;
  return code;
}

/**
 * Bracket placeholder text for a slot source:
 * "A1" → "1. Gruppe A", "B2" → "2. Gruppe B", "W:QF1" → "Sieger Viertelfinal 1",
 * "W:SF2" → "Sieger Halbfinal 2". Unknown sources are returned unchanged; null → "Offen".
 */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Offen";
  const group = /^([A-D])([12])$/.exec(source);
  if (group) return `${group[2]}. Gruppe ${group[1]}`;
  const winner = /^W:(QF\d+|SF\d+|F)$/.exec(source);
  if (winner) return `Sieger ${matchLabel(winner[1], "KNOCKOUT", 0, null)}`;
  return source;
}
