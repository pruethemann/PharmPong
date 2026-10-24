// Game tables: disable a broken table, rename. Table state
// (Available/Reserved/In progress/Disabled) is derived elsewhere (domain/table-state).
import { db, type Tx } from "@/server/db";
import { assertRole } from "@/server/auth/roles";
import type { Actor } from "@/server/auth/sessions";
import { fail } from "@/server/domain/errors";
import { ACTIVE_MATCH_STATUSES } from "@/server/domain/types";
import { writeAudit } from "./audit";
import { REASON_MAX, REASON_MIN, type ServiceOpts } from "./tournament";
import { withTournamentTx } from "./tx";

export const TABLE_NAME_MAX = 40;

type LockedTable = { id: string; tournamentId: string; number: number; name: string; isDisabled: boolean };

async function tableTournamentId(tableId: string, opts?: ServiceOpts): Promise<string> {
  const t = await (opts?.client ?? db).gameTable.findUnique({
    where: { id: tableId },
    select: { tournamentId: true },
  });
  if (!t || (opts?.tournamentId && opts.tournamentId !== t.tournamentId))
    fail("NOT_FOUND", "Tisch nicht gefunden.");
  return t.tournamentId;
}

async function lockTable(tx: Tx, tableId: string): Promise<LockedTable> {
  const rows = await tx.$queryRaw<LockedTable[]>`
    SELECT id, "tournamentId", number, name, "isDisabled" FROM "GameTable" WHERE id = ${tableId} FOR UPDATE`;
  if (!rows[0]) fail("NOT_FOUND", "Tisch nicht gefunden.");
  return rows[0];
}

export async function setTableDisabled(
  actor: Actor,
  tableId: string,
  disabled: boolean,
  reason: string,
  opts?: ServiceOpts,
) {
  assertRole(actor, "ADMIN");
  const r = typeof reason === "string" ? reason.trim() : "";
  if (disabled && (r.length < REASON_MIN || r.length > REASON_MAX)) {
    fail("VALIDATION", `Bitte gib eine Begründung mit ${REASON_MIN}–${REASON_MAX} Zeichen an.`, {
      field: "reason",
    });
  }
  const tournamentId = await tableTournamentId(tableId, opts);
  return withTournamentTx(
    tournamentId,
    async (tx, ctx) => {
      const table = await lockTable(tx, tableId);
      if (table.isDisabled === disabled) {
        ctx.dirty = false;
        return { id: table.id, isDisabled: table.isDisabled, changed: false };
      }
      if (disabled) {
        const active = await tx.match.findFirst({
          where: { tableId, status: { in: [...ACTIVE_MATCH_STATUSES] } },
          select: { id: true, code: true, status: true },
        });
        if (active) {
          fail(
            "TABLE_BUSY",
            `An diesem Tisch ist Spiel ${active.code} aktiv. Bitte zuerst zurückziehen oder abbrechen.`,
            {
              matchId: active.id,
              code: active.code,
              status: active.status,
            },
          );
        }
      }
      await tx.gameTable.update({ where: { id: tableId }, data: { isDisabled: disabled } });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: disabled ? "table.disable" : "table.enable",
        entityType: "GameTable",
        entityId: tableId,
        before: { isDisabled: table.isDisabled },
        after: { isDisabled: disabled },
        reason: r || null,
      });
      return { id: table.id, isDisabled: disabled, changed: true };
    },
    opts?.client ? { client: opts.client } : {},
  );
}

export async function renameTable(actor: Actor, tableId: string, name: string, opts?: ServiceOpts) {
  assertRole(actor, "ADMIN");
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (clean.length < 1 || clean.length > TABLE_NAME_MAX) {
    fail("VALIDATION", `Der Tischname muss 1–${TABLE_NAME_MAX} Zeichen lang sein.`, { field: "name" });
  }
  const tournamentId = await tableTournamentId(tableId, opts);
  return withTournamentTx(
    tournamentId,
    async (tx) => {
      const table = await lockTable(tx, tableId);
      await tx.gameTable.update({ where: { id: tableId }, data: { name: clean } });
      await writeAudit(tx, {
        tournamentId,
        actorId: actor.id,
        action: "table.rename",
        entityType: "GameTable",
        entityId: tableId,
        before: { name: table.name },
        after: { name: clean },
      });
      return { id: tableId, name: clean };
    },
    opts?.client ? { client: opts.client } : {},
  );
}
