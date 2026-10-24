// Admin match operations: filters, available actions per status, alerts. Pure.
import type { AuthedSnapshot, LiveMatch } from "@/lib/live-types";
import type { MatchStatusKey } from "@/lib/i18n/de";

export type PhaseFilter = "all" | "GROUP" | "KNOCKOUT";
export type StatusFilter = "all" | "active" | "awaiting" | "ready" | "pending" | "done" | "issues";

export const PHASE_FILTERS: readonly { value: PhaseFilter; label: string }[] = [
  { value: "all", label: "Alle Phasen" },
  { value: "GROUP", label: "Gruppen" },
  { value: "KNOCKOUT", label: "K.-o." },
];

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Am Tisch" },
  { value: "awaiting", label: "Wartet" },
  { value: "ready", label: "Bereit" },
  { value: "pending", label: "Offen" },
  { value: "done", label: "Entschieden" },
  { value: "issues", label: "Probleme" },
];

const STATUS_GROUPS: Record<Exclude<StatusFilter, "all" | "issues">, readonly MatchStatusKey[]> = {
  active: ["ASSIGNED", "IN_PROGRESS"],
  awaiting: ["AWAITING_CONFIRMATION"],
  ready: ["READY"],
  pending: ["PENDING"],
  done: ["COMPLETED", "FORFEITED", "CANCELLED"],
};

export function isPhaseFilter(v: unknown): v is PhaseFilter {
  return PHASE_FILTERS.some((f) => f.value === v);
}
export function isStatusFilter(v: unknown): v is StatusFilter {
  return STATUS_FILTERS.some((f) => f.value === v);
}

export function matchesFilter(
  m: Pick<LiveMatch, "id" | "stage" | "status">,
  phase: PhaseFilter,
  status: StatusFilter,
  openIssueIds: ReadonlySet<string>,
): boolean {
  if (phase !== "all" && m.stage !== phase) return false;
  if (status === "all") return true;
  if (status === "issues") return openIssueIds.has(m.id);
  return STATUS_GROUPS[status].includes(m.status);
}

export type MatchActionKind =
  "assign" | "unassign" | "confirm" | "reject" | "abort" | "forfeit" | "correct" | "resolveIssue";

/** Admin actions offered for a match, in display order (first = primary). */
export function availableMatchActions(
  status: MatchStatusKey,
  opts: { hasBothTeams: boolean; hasOpenIssue: boolean },
): MatchActionKind[] {
  const out: MatchActionKind[] = [];
  if (opts.hasOpenIssue) out.push("resolveIssue");
  switch (status) {
    case "READY":
      out.push("assign");
      break;
    case "ASSIGNED":
      out.push("unassign", "abort");
      break;
    case "IN_PROGRESS":
      out.push("abort");
      break;
    case "AWAITING_CONFIRMATION":
      out.push("confirm", "reject", "abort");
      break;
    case "COMPLETED":
    case "FORFEITED":
      out.push("correct");
      break;
    default:
      break;
  }
  if (
    opts.hasBothTeams &&
    (status === "READY" ||
      status === "ASSIGNED" ||
      status === "IN_PROGRESS" ||
      status === "AWAITING_CONFIRMATION")
  ) {
    out.push("forfeit");
  }
  return out;
}

export type AdminAlert = {
  id: string;
  tone: "destructive" | "warning" | "info";
  title: string;
  detail?: string;
  href: string;
  cta: string;
};

/** Things the admin should act on, most urgent first. */
export function deriveAlerts(
  snap: Pick<AuthedSnapshot, "matches" | "teams" | "tournament" | "matchOps" | "admin" | "tables">,
  extra: { incompleteTeams: { id: string; name: string }[] } = { incompleteTeams: [] },
): AdminAlert[] {
  const alerts: AdminAlert[] = [];
  const teamName = (id: string) => snap.teams.find((t) => t.id === id)?.name ?? "?";
  const byId = new Map(snap.matches.map((m) => [m.id, m]));

  for (const [matchId, ops] of Object.entries(snap.matchOps ?? {})) {
    if (ops.openIssue == null) continue;
    const m = byId.get(matchId);
    alerts.push({
      id: `issue-${matchId}`,
      tone: "destructive",
      title: `Problem bei ${m?.code ?? "Spiel"}`,
      detail: ops.openIssue || "Ohne Beschreibung",
      href: `/admin/matches?match=${encodeURIComponent(matchId)}`,
      cta: "Lösen",
    });
  }
  for (const tie of snap.admin?.unresolvedTies ?? []) {
    alerts.push({
      id: `tie-${tie.group}-${tie.basisHash}`,
      tone: "destructive",
      title: `Gleichstand in Gruppe ${tie.group}`,
      detail: `${tie.teamIds.map(teamName).join(", ")}: Ranking-Shootout erfassen.`,
      href: `/admin/tournament#shootout-${tie.group}`,
      cta: "Shootout erfassen",
    });
  }
  for (const m of snap.matches) {
    if (m.status !== "AWAITING_CONFIRMATION") continue;
    alerts.push({
      id: `await-${m.id}`,
      tone: "warning",
      title: `${m.code} wartet auf Bestätigung`,
      detail: `${m.homeTeamId ? teamName(m.homeTeamId) : "?"} vs ${m.awayTeamId ? teamName(m.awayTeamId) : "?"}`,
      href: `/admin/matches?match=${encodeURIComponent(m.id)}`,
      cta: "Prüfen",
    });
  }
  for (const t of snap.tables) {
    if (t.state !== "DISABLED") continue;
    alerts.push({
      id: `table-${t.id}`,
      tone: "info",
      title: `Tisch ${t.number} ist gesperrt`,
      detail: t.name,
      href: "/admin/tournament#tische",
      cta: "Tische",
    });
  }
  if (extra.incompleteTeams.length > 0) {
    const n = extra.incompleteTeams.length;
    alerts.push({
      id: "incomplete-teams",
      tone: "warning",
      title: `${n} unvollständige${n === 1 ? "s" : ""} Team${n === 1 ? "" : "s"}`,
      detail: extra.incompleteTeams.map((t) => t.name).join(", "),
      href: "/admin/teams",
      cta: "Teams",
    });
  }
  if (snap.tournament.isPaused) {
    alerts.unshift({
      id: "paused",
      tone: "warning",
      title: "Turnier ist pausiert",
      detail: "Es können keine Spiele zugewiesen oder gestartet werden.",
      href: "/admin#steuerung",
      cta: "Fortsetzen",
    });
  }
  return alerts;
}

/** Stable sort for admin match lists: play order. */
export function sortByPlayOrder<T extends Pick<LiveMatch, "orderIndex">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.orderIndex - b.orderIndex);
}
