// Full-event simulation (spec §18): 24 demo players, 12 teams, all 19 matches,
// driven exclusively through the real services (Prisma is only used for reads).
//
// Scenario (deterministic for a given seed, apart from cuid-based team ids):
//   (a) group A ends in a perfect three-way tie → startKnockout fails with
//       UNRESOLVED_TIE until a ranking shootout is recorded;
//   (b) SHOOTOUT results (B-1, QF2);
//   (c) TIME_LIMIT results (C-1, F);
//   (d) QF1 is corrected (winner flipped) while SF1 is READY → SF1 home slot re-seeded;
//   (e) a correction of QF3 after SF1 has started fails with DOWNSTREAM_STARTED;
//   (f) both tables run concurrently (two matches IN_PROGRESS at the same time);
//   (g) the final crowns the champion.
// Not imported by the app at runtime (scripts and integration tests only).
import { db, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/sessions";
import { randomToken } from "@/server/auth/tokens";
import type { Rng } from "@/server/domain/draw";
import { isDomainError, fail } from "@/server/domain/errors";
import { GROUP_NAMES, type GroupName } from "@/server/domain/types";
import { createAdminIfMissing, ensureTournament } from "@/server/services/bootstrap";
import { correctResult } from "@/server/services/corrections";
import { buildAuthedSnapshot, buildPublicSnapshot } from "@/server/services/live-snapshot";
import { assignMatch, startMatch } from "@/server/services/matches";
import { confirmResult, proposeResult, type ResultFields } from "@/server/services/results";
import { stableJson } from "@/server/services/idempotency";
import { createTeam, joinTeam } from "@/server/services/teams";
import { listUnresolvedTies, recordRankingShootout } from "@/server/services/tiebreaks";
import {
  generateDraw,
  lockRegistration,
  openRegistration,
  startGroupStage,
  startKnockout,
} from "@/server/services/tournament";
import type { AuthedSnapshot } from "@/lib/live-types";
import { createDemoParticipants, DEMO_REFEREE_EMAIL, DEMO_TEAMS, demoEmail } from "./demo-data";

export const SIM_ADMIN_EMAIL = "sim-admin@pharmapong.test";

export type SimulationOptions = {
  seed: number;
  log?: (message: string) => void;
  /** Defaults to the open tournament (created if missing). */
  tournamentId?: string;
  client?: Db;
  /** Password for newly created demo accounts (random when omitted). */
  demoPassword?: string;
};

export type SimulationEventKind =
  | "UNRESOLVED_TIE_BLOCKED"
  | "RANKING_SHOOTOUT"
  | "SHOOTOUT_RESULT"
  | "TIME_LIMIT_RESULT"
  | "CONCURRENT_MATCHES"
  | "IDEMPOTENT_REPLAY"
  | "CORRECTION"
  | "CORRECTION_BLOCKED"
  | "CHAMPION";

export type SimulationEvent = { kind: SimulationEventKind; code?: string; detail: string };

export type SimulationReport = {
  tournamentId: string;
  seed: number;
  matchesPlayed: number;
  championTeamId: string;
  championName: string;
  maxConcurrentInProgress: number;
  revisionBefore: number;
  revisionAfter: number;
  /** Team ids by group in draw position order (1..3). */
  groups: Record<GroupName, string[]>;
  events: SimulationEvent[];
};

// ─── Deterministic RNG ─────────────────────────────────────────────────────

/** mulberry32: small seeded PRNG, adapted to the draw's Rng contract. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * maxExclusive);
  };
}

// ─── Result plan ───────────────────────────────────────────────────────────

/** "HOME"/"AWAY" winner with the remaining cups of home and away. */
type PlannedResult = {
  winner: "HOME" | "AWAY";
  home: number;
  away: number;
  endType: ResultFields["endType"];
};

const r = (
  winner: "HOME" | "AWAY",
  home: number,
  away: number,
  endType: ResultFields["endType"] = "REGULAR",
) => ({
  winner,
  home,
  away,
  endType,
});

/**
 * Group fixtures by draw position: X-1 = p1 vs p2, X-2 = p3 vs p1, X-3 = p2 vs p3.
 * Group A is a cycle (p1>p2, p3>p1, p2>p3), every win 4:0 → identical stats for all three.
 * Groups B–D: p1 wins both, p2 beats p3 (distinct points, no ties).
 */
export const GROUP_PLAN: Record<string, PlannedResult> = {
  "A-1": r("HOME", 4, 0),
  "A-2": r("HOME", 4, 0),
  "A-3": r("HOME", 4, 0),
  "B-1": r("HOME", 3, 3, "SHOOTOUT"),
  "B-2": r("AWAY", 0, 5),
  "B-3": r("HOME", 2, 0),
  "C-1": r("HOME", 5, 2, "TIME_LIMIT"),
  "C-2": r("AWAY", 0, 6),
  "C-3": r("HOME", 3, 0),
  "D-1": r("HOME", 7, 0),
  "D-2": r("AWAY", 0, 2),
  "D-3": r("HOME", 1, 0),
};

/** Knockout plan as confirmed by the referee (QF1 is corrected afterwards, see CORRECTED_QF1). */
export const KNOCKOUT_PLAN: Record<string, PlannedResult> = {
  QF1: r("HOME", 3, 0),
  QF2: r("HOME", 2, 2, "SHOOTOUT"),
  QF3: r("HOME", 5, 0),
  QF4: r("AWAY", 0, 4),
  SF1: r("HOME", 2, 0),
  SF2: r("AWAY", 0, 1),
  F: r("HOME", 3, 1, "TIME_LIMIT"),
};

/** The admin's correction of QF1 (the away team actually won). */
export const CORRECTED_QF1: PlannedResult = r("AWAY", 0, 3);
/** The attempted (blocked) correction of QF3 after SF1 started. */
export const BLOCKED_QF3: PlannedResult = r("AWAY", 0, 2);

const RANKING_SHOOTOUT_GROUP: GroupName = "A";

function toResult(plan: PlannedResult, homeTeamId: string, awayTeamId: string): ResultFields {
  return {
    winnerTeamId: plan.winner === "HOME" ? homeTeamId : awayTeamId,
    homeCupsRemaining: plan.home,
    awayCupsRemaining: plan.away,
    endType: plan.endType,
  };
}

// ─── Actors & participants ─────────────────────────────────────────────────

async function actorByEmail(client: Db, email: string): Promise<Actor> {
  const u = await client.user.findUnique({ where: { email } });
  if (!u || !u.isActive) fail("NOT_FOUND", `Benutzer:in ${email} nicht gefunden.`);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

/**
 * Dedicated simulation admin (random password nobody knows, so the account
 * cannot be used to sign in). Created if missing; an existing non-admin account
 * with this address is never promoted (FORBIDDEN).
 */
export async function ensureSimAdmin(client: Db = db): Promise<Actor> {
  // Never promote an existing account: whoever registered this address first
  // would otherwise become admin. Create it only when missing.
  await createAdminIfMissing(SIM_ADMIN_EMAIL, randomToken(24), client);
  const admin = await actorByEmail(client, SIM_ADMIN_EMAIL);
  if (admin.role !== "ADMIN") {
    fail("FORBIDDEN", "Das Simulations-Konto existiert bereits ohne Admin-Rechte. Bitte prüfen.");
  }
  // In-process actor, never a login session: the stored mustChangePassword flag
  // (kept true so the account cannot be used interactively) does not apply.
  return { ...admin, mustChangePassword: false };
}

async function completeTeamCount(client: Db, tournamentId: string): Promise<number> {
  const teams = await client.team.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { _count: { select: { members: { where: { leftAt: null } } } } },
  });
  return teams.filter((t) => t._count.members === 2).length;
}

/**
 * 12 complete demo teams in this tournament. New demo accounts are created by
 * the demo seed; when the accounts already exist (earlier tournament), the
 * players found their teams through the regular team services.
 */
async function ensureDemoTeams(
  client: Db,
  tournamentId: string,
  password: string,
  log: (m: string) => void,
): Promise<void> {
  const seeded = await createDemoParticipants(client, { tournamentId, password });
  if (seeded.created) {
    log(`Demo-Teilnehmende erstellt: ${seeded.users} Spieler:innen, ${seeded.teams} Teams.`);
    return;
  }
  const status = (await client.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).status;
  if (status === "DRAFT") fail("INVALID_STATE", "Die Anmeldung muss zuerst geöffnet werden.");
  const existing = await completeTeamCount(client, tournamentId);
  if (existing === DEMO_TEAMS.length) {
    log(`Bestehende ${existing} vollständige Teams werden verwendet.`);
    return;
  }
  const anyTeams = await client.team.count({ where: { tournamentId, status: "ACTIVE" } });
  if (anyTeams > 0) {
    fail(
      "INVALID_STATE",
      `Das Turnier hat bereits ${anyTeams} Teams (davon ${existing} vollständig). Simulation braucht ein leeres Turnier oder genau 12 vollständige Teams.`,
    );
  }
  for (const [i, t] of DEMO_TEAMS.entries()) {
    const captain = await actorByEmail(client, demoEmail(2 * i + 1));
    const partner = await actorByEmail(client, demoEmail(2 * i + 2));
    const created = await createTeam(captain, { name: t.name, motto: t.motto }, { tournamentId });
    await joinTeam(partner, created.inviteCode, { tournamentId });
  }
  log(`Bestehende Demo-Konten haben ${DEMO_TEAMS.length} Teams gegründet.`);
}

// ─── Simulation ────────────────────────────────────────────────────────────

type Ctx = {
  client: Db;
  tournamentId: string;
  admin: Actor;
  referee: Actor;
  log: (m: string) => void;
  events: SimulationEvent[];
  played: number;
  maxConcurrent: number;
  replayChecked: boolean;
  qf1Corrected: boolean;
  blockedChecked: boolean;
};

const keyFor = (c: Ctx, code: string, step: string, rev: number) =>
  `sim:${c.tournamentId}:${code}:${step}:${rev}`;

function event(c: Ctx, kind: SimulationEventKind, detail: string, code?: string) {
  c.events.push({ kind, code, detail });
  c.log(`[${kind}]${code ? ` ${code}:` : ""} ${detail}`);
}

async function adminSnapshot(c: Ctx): Promise<AuthedSnapshot> {
  return buildAuthedSnapshot(c.admin, c.tournamentId, c.client);
}

function plannedFor(code: string): PlannedResult {
  const plan = GROUP_PLAN[code] ?? KNOCKOUT_PLAN[code];
  if (!plan) fail("INTERNAL", `Kein Resultat für ${code} geplant.`);
  return plan;
}

/** Correction (d): flip QF1 while SF1 is READY (both QFs feeding it decided, SF1 not started). */
async function maybeCorrectQf1(c: Ctx, snap: AuthedSnapshot): Promise<boolean> {
  if (c.qf1Corrected) return false;
  const qf1 = snap.matches.find((m) => m.code === "QF1");
  const sf1 = snap.matches.find((m) => m.code === "SF1");
  if (!qf1 || !sf1 || qf1.status !== "COMPLETED" || sf1.status !== "READY") return false;
  const before = sf1.homeTeamId;
  const ops = snap.matchOps![qf1.id];
  const out = await correctResult(
    c.admin,
    {
      matchId: qf1.id,
      expectedVersion: ops.version,
      reason: "Schiri-Meldung: Sieg falsch erfasst, Gastteam hat gewonnen.",
      ...toResult(CORRECTED_QF1, qf1.homeTeamId!, qf1.awayTeamId!),
    },
    { client: c.client },
  );
  const sf1After = await c.client.match.findUniqueOrThrow({ where: { id: sf1.id } });
  if (sf1After.homeTeamId !== qf1.awayTeamId || sf1After.homeTeamId === before) {
    fail("INTERNAL", "SF1 wurde nach der Korrektur von QF1 nicht neu gesetzt.");
  }
  c.qf1Corrected = true;
  event(
    c,
    "CORRECTION",
    `Sieger geändert, SF1-Heimplatz neu gesetzt (re-seeded: ${out.reseeded.join(", ") || "–"}).`,
    "QF1",
  );
  return true;
}

/** Correction (e): once SF1 runs, changing QF3's winner must fail with DOWNSTREAM_STARTED. */
async function attemptBlockedCorrection(c: Ctx): Promise<void> {
  if (c.blockedChecked) return;
  const snap = await adminSnapshot(c);
  const sf1 = snap.matches.find((m) => m.code === "SF1");
  const qf3 = snap.matches.find((m) => m.code === "QF3");
  if (!sf1 || !qf3 || sf1.status !== "IN_PROGRESS") return;
  try {
    await correctResult(
      c.admin,
      {
        matchId: qf3.id,
        expectedVersion: snap.matchOps![qf3.id].version,
        reason: "Nachträgliche Korrektur nach Start des Halbfinals.",
        ...toResult(BLOCKED_QF3, qf3.homeTeamId!, qf3.awayTeamId!),
      },
      { client: c.client },
    );
  } catch (e) {
    if (isDomainError(e) && e.code === "DOWNSTREAM_STARTED") {
      c.blockedChecked = true;
      event(c, "CORRECTION_BLOCKED", `Korrektur abgelehnt (DOWNSTREAM_STARTED), SF1 läuft bereits.`, "QF3");
      return;
    }
    throw e;
  }
  fail("INTERNAL", "Korrektur von QF3 nach dem Start von SF1 hätte scheitern müssen.");
}

/** Group stage done: knockout start must be blocked by group A's tie until the shootout is recorded. */
async function startKnockoutWithShootout(c: Ctx, groups: Record<GroupName, string[]>): Promise<void> {
  try {
    await startKnockout(c.admin, { tournamentId: c.tournamentId, client: c.client });
    fail("INTERNAL", "startKnockout hätte wegen des Gleichstands in Gruppe A scheitern müssen.");
  } catch (e) {
    if (!isDomainError(e) || e.code !== "UNRESOLVED_TIE") throw e;
    event(c, "UNRESOLVED_TIE_BLOCKED", "K.-o.-Start blockiert: Dreifach-Gleichstand in Gruppe A.");
  }
  const ties = await listUnresolvedTies(c.tournamentId, c.client);
  const tie = ties.find((t) => t.group === RANKING_SHOOTOUT_GROUP);
  if (!tie || tie.teamIds.length !== 3 || ties.length !== 1) {
    fail("INTERNAL", "Erwartet: genau ein Dreifach-Gleichstand in Gruppe A.", { ties });
  }
  // The shootout order follows the draw positions (p1 > p2 > p3).
  const ordered = groups[RANKING_SHOOTOUT_GROUP];
  await recordRankingShootout(
    c.admin,
    {
      group: RANKING_SHOOTOUT_GROUP,
      basisHash: tie.basisHash,
      orderedTeamIds: ordered,
      note: "Simulation: Ranking-Shootout am Tisch 1",
    },
    { tournamentId: c.tournamentId, client: c.client },
  );
  const nameOf = new Map(tie.teams.map((t) => [t.id, t.name]));
  event(c, "RANKING_SHOOTOUT", `Reihenfolge erfasst: ${ordered.map((id) => nameOf.get(id)).join(" > ")}.`);
  await startKnockout(c.admin, { tournamentId: c.tournamentId, client: c.client });
  c.log("K.-o.-Phase gestartet.");
}

/** One round: assign the suggested matches (one per table), start them, then propose + confirm concurrently. */
async function playRound(c: Ctx, snap: AuthedSnapshot): Promise<number> {
  const suggestions = snap.admin?.suggestions ?? [];
  if (suggestions.length === 0) return 0;
  const refSnap = await buildAuthedSnapshot(c.referee, c.tournamentId, c.client);
  const opsOf = refSnap.matchOps!;
  const running: { id: string; code: string; home: string; away: string; version: number }[] = [];

  for (const s of suggestions.slice(0, 2)) {
    const m = refSnap.matches.find((x) => x.id === s.matchId)!;
    const assigned = await assignMatch(
      c.referee,
      { matchId: m.id, tableId: s.tableId, expectedVersion: opsOf[m.id].version },
      { client: c.client },
    );
    const started = await startMatch(
      c.referee,
      { matchId: m.id, expectedVersion: assigned.version },
      { client: c.client },
    );
    running.push({
      id: m.id,
      code: m.code,
      home: m.homeTeamId!,
      away: m.awayTeamId!,
      version: started.version,
    });
  }

  const inProgress = await c.client.match.count({
    where: { tournamentId: c.tournamentId, status: "IN_PROGRESS" },
  });
  if (inProgress > c.maxConcurrent) c.maxConcurrent = inProgress;
  if (inProgress >= 2 && !c.events.some((e) => e.kind === "CONCURRENT_MATCHES")) {
    event(
      c,
      "CONCURRENT_MATCHES",
      `${running.map((r) => r.code).join(" und ")} laufen gleichzeitig auf beiden Tischen.`,
    );
  }

  await attemptBlockedCorrection(c);

  // Both referees submit at the same time; the tournament lock serializes them.
  const proposed = await Promise.all(
    running.map((m) =>
      proposeResult(
        c.referee,
        {
          matchId: m.id,
          expectedVersion: m.version,
          idempotencyKey: keyFor(c, m.code, "propose", 1),
          ...toResult(plannedFor(m.code), m.home, m.away),
        },
        { client: c.client },
      ),
    ),
  );
  const confirmed = await Promise.all(
    running.map((m, i) =>
      confirmResult(
        c.referee,
        {
          matchId: m.id,
          expectedVersion: proposed[i].version,
          resultRevision: proposed[i].resultRevision,
          idempotencyKey: keyFor(c, m.code, "confirm", proposed[i].resultRevision),
        },
        { client: c.client },
      ),
    ),
  );

  if (!c.replayChecked) {
    // Duplicate submission (e.g. a double tap after a network hiccup) must replay, not re-run.
    const m = running[0];
    const revBefore = (await c.client.tournament.findUniqueOrThrow({ where: { id: c.tournamentId } }))
      .revision;
    const replay = await confirmResult(
      c.referee,
      {
        matchId: m.id,
        expectedVersion: proposed[0].version,
        resultRevision: proposed[0].resultRevision,
        idempotencyKey: keyFor(c, m.code, "confirm", proposed[0].resultRevision),
      },
      { client: c.client },
    );
    const revAfter = (await c.client.tournament.findUniqueOrThrow({ where: { id: c.tournamentId } }))
      .revision;
    // Compare structurally: the stored response comes back from jsonb (key order may differ).
    if (stableJson(replay) !== stableJson(confirmed[0]) || revAfter !== revBefore) {
      fail("INTERNAL", "Doppelte Bestätigung wurde nicht idempotent behandelt.", {
        replay,
        first: confirmed[0],
        revBefore,
        revAfter,
      });
    }
    c.replayChecked = true;
    event(
      c,
      "IDEMPOTENT_REPLAY",
      "Doppelte Bestätigung lieferte dieselbe Antwort ohne neue Revision.",
      m.code,
    );
  }

  for (const [i, m] of running.entries()) {
    const plan = plannedFor(m.code);
    if (plan.endType === "SHOOTOUT")
      event(c, "SHOOTOUT_RESULT", `Shootout bei ${plan.home}:${plan.away}.`, m.code);
    if (plan.endType === "TIME_LIMIT") {
      event(c, "TIME_LIMIT_RESULT", `Zeitablauf, ${plan.home}:${plan.away} Becher übrig.`, m.code);
    }
    const championId = confirmed[i].championTeamId;
    if (championId) {
      const champion = await c.client.team.findUniqueOrThrow({ where: { id: championId } });
      event(c, "CHAMPION", `Turniersieger: ${champion.name}.`, m.code);
    }
  }
  c.played += running.length;
  c.log(`Gespielt: ${running.map((m) => m.code).join(", ")} (${c.played}/19)`);
  return running.length;
}

export async function simulateTournament(opts: SimulationOptions): Promise<SimulationReport> {
  const client = opts.client ?? db;
  const log = opts.log ?? (() => {});
  const tournamentId = opts.tournamentId ?? (await ensureTournament(client));
  const start = await client.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const drawn = await client.group.count({ where: { tournamentId } });
  if (!["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_LOCKED"].includes(start.status) || drawn > 0) {
    fail("INVALID_STATE", "Die Simulation braucht ein Turnier vor der Auslosung.", { status: start.status });
  }

  const admin = await ensureSimAdmin(client);
  const sopts = { tournamentId, client };
  if (start.status === "DRAFT") await openRegistration(admin, sopts);
  if (start.status !== "REGISTRATION_LOCKED") {
    await ensureDemoTeams(client, tournamentId, opts.demoPassword ?? randomToken(18), log);
    await lockRegistration(admin, sopts);
  }
  const referee = await actorByEmail(client, DEMO_REFEREE_EMAIL);

  const draw = await generateDraw(admin, { rng: seededRng(opts.seed) }, sopts);
  const groups = Object.fromEntries(draw.groups.map((g) => [g.name, g.teams.map((t) => t.id)])) as Record<
    GroupName,
    string[]
  >;
  for (const g of draw.groups) log(`Gruppe ${g.name}: ${g.teams.map((t) => t.name).join(", ")}`);
  await startGroupStage(admin, sopts);

  const c: Ctx = {
    client,
    tournamentId,
    admin,
    referee,
    log,
    events: [],
    played: 0,
    maxConcurrent: 0,
    replayChecked: false,
    qf1Corrected: false,
    blockedChecked: false,
  };

  for (let guard = 0; guard < 40; guard++) {
    const snap = await adminSnapshot(c);
    if (snap.tournament.status === "COMPLETED") break;
    const fresh = (await maybeCorrectQf1(c, snap)) ? await adminSnapshot(c) : snap;
    if ((await playRound(c, fresh)) > 0) continue;
    if (fresh.tournament.status === "GROUP_STAGE") {
      await startKnockoutWithShootout(c, groups);
      continue;
    }
    fail("INTERNAL", "Simulation steckt fest: keine zuweisbaren Spiele.", {
      status: fresh.tournament.status,
      open: fresh.matches.filter((m) => m.status !== "COMPLETED").map((m) => `${m.code}:${m.status}`),
    });
  }

  const end = await client.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (end.status !== "COMPLETED" || !end.championTeamId) fail("INTERNAL", "Das Turnier wurde nicht beendet.");
  for (const [ok, what] of [
    [c.maxConcurrent >= 2, "zwei gleichzeitige Spiele"],
    [c.qf1Corrected, "Korrektur von QF1"],
    [c.blockedChecked, "blockierte Korrektur von QF3"],
    [c.replayChecked, "idempotente Bestätigung"],
  ] as const) {
    if (!ok) fail("INTERNAL", `Szenario nicht durchlaufen: ${what}.`);
  }
  const champion = await client.team.findUniqueOrThrow({ where: { id: end.championTeamId } });
  // Warm the public snapshot so the display shows the champion right away.
  await buildPublicSnapshot(tournamentId, client);

  return {
    tournamentId,
    seed: opts.seed,
    matchesPlayed: c.played,
    championTeamId: champion.id,
    championName: champion.name,
    maxConcurrentInProgress: c.maxConcurrent,
    revisionBefore: start.revision,
    revisionAfter: end.revision,
    groups: Object.fromEntries(GROUP_NAMES.map((g) => [g, groups[g]])) as Record<GroupName, string[]>,
    events: c.events,
  };
}
