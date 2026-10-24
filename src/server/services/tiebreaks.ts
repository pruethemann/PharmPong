// Administrator-recorded ranking shootouts for persistent group ties.
// A decision is bound to the tie's basisHash (tied set + stats): a later result
// correction changes the hash, the old decision no longer matches and the tie
// reappears as unresolved (it must then be voided and re-recorded).
import { db, type Db } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { GROUP_NAMES, type GroupName, type UnresolvedTie } from "@/server/domain/types";
import { writeAudit } from "./audit";
import { loadTournamentState } from "./state";
import { resolveTournamentId, REASON_MAX, REASON_MIN, type ServiceOpts } from "./tournament";
import { withTournamentTx } from "./tx";

export type UnresolvedTieView = UnresolvedTie & { teams: { id: string; name: string }[] };

export async function listUnresolvedTies(
  tournamentId?: string,
  client: Db = db,
): Promise<UnresolvedTieView[]> {
  const id = await resolveTournamentId({ tournamentId, client });
  const state = await loadTournamentState(client, id);
  const ties = state.standings.flatMap((s) => s.unresolved);
  if (ties.length === 0) return [];
  const teams = await client.team.findMany({
    where: { id: { in: ties.flatMap((t) => t.teamIds) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(teams.map((t) => [t.id, t.name]));
  return ties.map((t) => ({
    ...t,
    teams: t.teamIds.map((tid) => ({ id: tid, name: nameById.get(tid) ?? "" })),
  }));
}

export type RecordShootoutInput = {
  group: GroupName;
  basisHash: string;
  orderedTeamIds: string[];
  note?: string | null;
};

export async function recordRankingShootout(actor: Actor, input: RecordShootoutInput, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  if (!GROUP_NAMES.includes(input.group)) fail("VALIDATION", "Unbekannte Gruppe.", { field: "group" });
  const note = input.note?.trim() || null;
  if (note && note.length > REASON_MAX) {
    fail("VALIDATION", `Die Notiz darf höchstens ${REASON_MAX} Zeichen lang sein.`, { field: "note" });
  }
  const tournamentId = await resolveTournamentId(opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status !== "GROUP_STAGE") {
        fail(
          "INVALID_STATE",
          "Ranking-Shootouts können nur während der Gruppenphase erfasst werden. Spätere Korrekturen laufen über die Wiederherstellung.",
        );
      }
      const state = await loadTournamentState(tx, tournamentId);
      const standings = state.standings.find((s) => s.group === input.group);
      const group = state.groups.find((g) => g.name === input.group);
      if (!standings || !group) fail("NOT_FOUND", "Gruppe nicht gefunden.");
      const tie = standings.unresolved.find((u) => u.basisHash === input.basisHash);
      if (!tie) {
        fail("STALE_VERSION", "Der Gleichstand hat sich inzwischen geändert. Bitte neu laden.", {
          group: input.group,
          current: standings.unresolved,
        });
      }
      const ordered = input.orderedTeamIds;
      const isPermutation =
        Array.isArray(ordered) &&
        ordered.length === tie.teamIds.length &&
        new Set(ordered).size === ordered.length &&
        ordered.every((id) => tie.teamIds.includes(id));
      if (!isPermutation) {
        fail("VALIDATION", "Die Reihenfolge muss genau die punktgleichen Teams enthalten.", {
          field: "orderedTeamIds",
          teamIds: tie.teamIds,
        });
      }
      const created = await tx.groupTiebreak.create({
        data: {
          groupId: group.id,
          teamIds: [...tie.teamIds].sort(),
          orderedTeamIds: ordered,
          basisHash: tie.basisHash,
          recordedById: actor.id,
          note,
        },
      });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tiebreak.record",
        entityType: "GroupTiebreak",
        entityId: created.id,
        after: {
          group: input.group,
          teamIds: created.teamIds,
          orderedTeamIds: created.orderedTeamIds,
          basisHash: created.basisHash,
          positions: tie.positions,
          note,
        },
      });
      return { id: created.id, group: input.group, orderedTeamIds: created.orderedTeamIds };
    },
    opts?.client ? { client: opts.client } : {},
  );
}

export async function voidRankingShootout(
  actor: Actor,
  tiebreakId: string,
  reason: string,
  opts?: ServiceOpts,
) {
  assertRole(actor, "ADMIN");
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < REASON_MIN || r.length > REASON_MAX) {
    fail("VALIDATION", `Bitte gib eine Begründung mit ${REASON_MIN}–${REASON_MAX} Zeichen an.`, {
      field: "reason",
    });
  }
  const client = opts?.client ?? db;
  const found = await client.groupTiebreak.findUnique({
    where: { id: tiebreakId },
    select: { group: { select: { tournamentId: true } } },
  });
  if (!found) fail("NOT_FOUND", "Shootout-Entscheid nicht gefunden.");
  const tournamentId = found.group.tournamentId;
  if (opts?.tournamentId && opts.tournamentId !== tournamentId) {
    fail("NOT_FOUND", "Shootout-Entscheid nicht gefunden.");
  }
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      if (ctx.tournament.status !== "GROUP_STAGE") {
        fail("INVALID_STATE", "Ranking-Shootouts können nur während der Gruppenphase aufgehoben werden.");
      }
      const tb = await tx.groupTiebreak.findUniqueOrThrow({
        where: { id: tiebreakId },
        include: { group: { select: { name: true } } },
      });
      if (tb.voidedAt) fail("INVALID_STATE", "Dieser Entscheid wurde bereits aufgehoben.");
      await tx.groupTiebreak.update({ where: { id: tiebreakId }, data: { voidedAt: ctx.now } });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "tiebreak.void",
        entityType: "GroupTiebreak",
        entityId: tiebreakId,
        before: {
          group: tb.group.name,
          teamIds: tb.teamIds,
          orderedTeamIds: tb.orderedTeamIds,
          basisHash: tb.basisHash,
          voidedAt: null,
        },
        after: { voidedAt: ctx.now },
        reason: r,
      });
      return { id: tiebreakId, voidedAt: ctx.now };
    },
    opts?.client ? { client: opts.client } : {},
  );
}
