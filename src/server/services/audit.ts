import type { Tx } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

export type AuditEntry = {
  tournamentId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tournamentId: entry.tournamentId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason ?? null,
    },
  });
}

export async function writeMatchEvent(
  tx: Tx,
  e: { tournamentId: string; matchId: string; type: string; actorId?: string | null; payload?: unknown },
): Promise<void> {
  await tx.matchEvent.create({
    data: {
      tournamentId: e.tournamentId,
      matchId: e.matchId,
      type: e.type,
      actorId: e.actorId ?? null,
      payload: json(e.payload),
    },
  });
}
