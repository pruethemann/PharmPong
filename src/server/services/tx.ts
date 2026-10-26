import { db, type Db, type Tx } from "@/server/db";
import { DomainError, fail } from "@/server/domain/errors";
import type { GameMode, TournamentStatus } from "@/generated/prisma/enums";
import { isRetryable, toDomainError } from "./pg-errors";

export type LockedTournament = {
  id: string;
  status: TournamentStatus;
  isPaused: boolean;
  revision: number;
  matchDurationSec: number;
  /** Read under the row lock: a mode switch cannot interleave with this transaction. */
  gameMode: GameMode;
};

export type TxContext = {
  tournament: LockedTournament;
  /** Database clock at lock time. Authoritative "now" for all timestamps in this tx. */
  now: Date;
  /** Set to false to skip the revision bump (pure reads under lock). */
  dirty: boolean;
};

export type TxOptions = {
  client?: Db;
  retries?: number;
  /** Test-only hook invoked after the work function, before commit. */
  afterWork?: (tx: Tx) => Promise<void>;
};

/**
 * Run `fn` inside a transaction holding a row lock on the tournament.
 * All tournament mutations go through here, which serializes writes per
 * tournament and bumps `revision` for live-sync clients.
 */
export async function withTournamentTx<T>(
  tournamentId: string,
  fn: (tx: Tx, ctx: TxContext) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const client = opts.client ?? db;
  const retries = opts.retries ?? 3;
  let attempt = 0;
  for (;;) {
    try {
      return await client.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<(LockedTournament & { now: Date })[]>`
            SELECT id, status, "isPaused", revision, "matchDurationSec", "gameMode", now() AS now
            FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
          const row = rows[0];
          if (!row) fail("NOT_FOUND", "Turnier nicht gefunden.");
          const { now, ...tournament } = row;
          const ctx: TxContext = { tournament, now, dirty: true };
          const result = await fn(tx, ctx);
          if (opts.afterWork) await opts.afterWork(tx);
          if (ctx.dirty) {
            await tx.$executeRaw`UPDATE "Tournament" SET revision = revision + 1, "updatedAt" = now() WHERE id = ${tournamentId}`;
          }
          return result;
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (e) {
      if (!(e instanceof DomainError) && isRetryable(e) && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
        continue;
      }
      throw toDomainError(e);
    }
  }
}

/** Fails with WRONG_MODE unless the locked tournament is in `mode`. */
export function assertGameMode(ctx: TxContext, mode: GameMode): void {
  if (ctx.tournament.gameMode !== mode) {
    fail(
      "WRONG_MODE",
      mode === "ELO"
        ? "Das geht nur im Elo-Modus. Die Turnierleitung hat den Turniermodus aktiv."
        : "Das geht nur im Turniermodus. Gerade läuft der Elo-Modus.",
      { mode: ctx.tournament.gameMode },
    );
  }
}

/** Plain transaction without tournament lock (e.g. user registration). */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: { client?: Db } = {}): Promise<T> {
  const client = opts.client ?? db;
  try {
    return await client.$transaction(fn, { maxWait: 5000, timeout: 15000 });
  } catch (e) {
    throw toDomainError(e);
  }
}

/** The currently open tournament (non-completed/cancelled), else the latest one. */
export async function getCurrentTournamentId(client: Db | Tx = db): Promise<string | null> {
  const open = await client.tournament.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  if (open) return open.id;
  const latest = await client.tournament.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
  return latest?.id ?? null;
}
