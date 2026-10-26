import Link from "next/link";
import { ChevronRight, Handshake, Repeat2, Trophy } from "lucide-react";
import { teamLabel } from "@/lib/elo-format";
import type { EloLiveMatch, EloSideKey } from "@/lib/elo-live-types";
import { TableBadge } from "@/components/pp/table-badge";
import { cn } from "@/lib/utils";
import { EloStatusPill, eloPillKey } from "./elo-status-pill";
import { SideTag } from "./elo-team";
import { DeltaText } from "./leaderboard";

/** Per-player change of one side (equal split, so every player of a side has the same delta). */
export function sideDelta(
  m: Pick<EloLiveMatch, "ratingChanges">,
  players: { userId: string }[],
): number | null {
  const first = players[0];
  if (!first) return null;
  return m.ratingChanges.find((c) => c.userId === first.userId)?.delta ?? null;
}

/** Why a completed match moved no ratings. */
export function unratedReason(m: Pick<EloLiveMatch, "rated" | "result">): string | null {
  if (!m.rated) return "Freundschaftsspiel";
  if (m.result?.multiplier === 0) return "Wiederholung: nicht gewertet";
  return null;
}

function SideLine({ m, side, winner }: { m: EloLiveMatch; side: EloSideKey; winner: EloSideKey | null }) {
  const players = side === "A" ? m.sideA : m.sideB;
  const delta = m.status === "COMPLETED" ? sideDelta(m, players) : null;
  const won = winner === side;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SideTag side={side} className="size-6 text-sm" />
      <span className={cn("min-w-0 flex-1 truncate", won ? "font-semibold" : "text-muted-foreground")}>
        {teamLabel(players.map((p) => p.displayName))}
      </span>
      {won && <Trophy className="text-gold size-4 shrink-0" aria-label="Sieger" />}
      {delta != null && <DeltaText value={delta} className="w-12 shrink-0 text-right text-sm" />}
    </div>
  );
}

/** Compact match row for result lists (pending and recent results). */
export function EloMatchRow({ match: m }: { match: EloLiveMatch }) {
  const completed = m.status === "COMPLETED";
  const winner = completed ? (m.result?.winnerSide ?? null) : null;
  const note = completed ? unratedReason(m) : null;
  const multiplier = m.result?.multiplier ?? null;
  const halved = completed && m.rated && multiplier != null && multiplier > 0 && multiplier < 1;
  return (
    <Link
      href={`/elo/matches/${m.id}`}
      className="bg-card hover:border-primary/60 flex items-center gap-3 rounded-2xl border p-3 transition-colors"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <TableBadge number={m.tableNumber} size="sm" muted />
          {!completed && <EloStatusPill status={eloPillKey(m)} size="sm" />}
          {!completed && m.report && (
            <span className="text-muted-foreground text-xs font-semibold">
              Gemeldet: Team {m.report.winnerSide} gewinnt
            </span>
          )}
          {note && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-semibold">
              {m.rated ? (
                <Repeat2 className="size-3.5" aria-hidden="true" />
              ) : (
                <Handshake className="size-3.5" aria-hidden="true" />
              )}
              {note}
            </span>
          )}
          {halved && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-semibold">
              <Repeat2 className="size-3.5" aria-hidden="true" /> Wiederholung: halb gewertet
            </span>
          )}
        </div>
        <SideLine m={m} side="A" winner={winner} />
        <SideLine m={m} side="B" winner={winner} />
      </div>
      <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
    </Link>
  );
}
