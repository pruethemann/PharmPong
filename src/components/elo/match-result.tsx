"use client";

import Link from "next/link";
import { Handshake, Medal, PartyPopper, Plus, Repeat2, Trophy, Zap } from "lucide-react";
import { formatPercent, formatRating, teamLabel } from "@/lib/elo-format";
import { eloEndTypeLabel } from "@/lib/i18n/de-elo";
import type { EloLeaderRow, EloLiveMatch, EloSideKey } from "@/lib/elo-live-types";
import type { EloMatchDetail } from "@/server/services/elo-read";
import { formatElapsed } from "@/server/domain/timer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SideTag } from "./elo-team";
import { DeltaText } from "./leaderboard";
import { PlayerAvatar } from "./player-avatar";
import { elapsedOf } from "./stopwatch";

type Change = { userId: string; side: EloSideKey; ratingBefore: number; delta: number; ratingAfter: number };

function changesOf(m: EloLiveMatch, detail: EloMatchDetail): Change[] {
  if (detail.status === "COMPLETED" && detail.ratingChanges.length > 0) {
    return detail.ratingChanges.map((c) => ({
      userId: c.userId,
      side: c.side,
      ratingBefore: c.ratingBefore,
      delta: c.delta,
      ratingAfter: c.ratingAfter,
    }));
  }
  const sideOf = new Map([...m.sideA, ...m.sideB].map((p) => [p.userId, p.side]));
  return m.ratingChanges.map((c) => ({
    userId: c.userId,
    side: sideOf.get(c.userId) ?? "A",
    ratingBefore: c.ratingAfter - c.delta,
    delta: c.delta,
    ratingAfter: c.ratingAfter,
  }));
}

function MyHero({
  won,
  delta,
  ratingAfter,
  row,
  players,
}: {
  won: boolean;
  delta: number | null;
  ratingAfter: number | null;
  row: EloLeaderRow | null;
  players: number;
}) {
  return (
    <section
      aria-label="Dein Ergebnis"
      className={cn(
        "animate-pop-in relative isolate flex flex-col items-center gap-2 overflow-hidden rounded-3xl border-2 p-6 text-center",
        won
          ? "border-gold/70 animate-glow bg-[radial-gradient(30rem_14rem_at_50%_0%,color-mix(in_oklch,var(--gold)_22%,transparent),transparent_70%)]"
          : "bg-card border-border",
      )}
    >
      {won ? (
        <PartyPopper className="text-gold size-12" aria-hidden="true" />
      ) : (
        <Medal className="text-muted-foreground size-12" aria-hidden="true" />
      )}
      <p className={cn("font-display text-5xl leading-none", won && "text-gold")}>
        {won ? "Gewonnen!" : "Knapp daneben"}
      </p>
      {delta != null && ratingAfter != null ? (
        <p className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <DeltaText value={delta} className="font-display text-4xl" />
          <span className="text-muted-foreground">
            jetzt{" "}
            <span className="font-display tabular text-foreground text-2xl">{formatRating(ratingAfter)}</span>{" "}
            Elo
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">Dieses Match ändert keine Elo-Punkte.</p>
      )}
      {row && (
        <p className="text-foreground/85">
          Rang <span className="font-display tabular text-2xl">{row.rank}</span> von {players}
        </p>
      )}
    </section>
  );
}

/** Completed match: celebration for the players, then everyone's Elo changes and the facts. */
export function CompletedResult({
  m,
  detail,
  meId,
  leaderboard,
  canPlayAgain,
}: {
  m: EloLiveMatch;
  detail: EloMatchDetail;
  meId: string | null;
  leaderboard: readonly EloLeaderRow[];
  canPlayAgain: boolean;
}) {
  const winner = m.result?.winnerSide ?? detail.result?.winnerSide ?? null;
  if (!winner) return null;
  const changes = changesOf(m, detail);
  const players = [...m.sideA, ...m.sideB];
  const mine = meId ? players.find((p) => p.userId === meId) : undefined;
  const myChange = mine ? changes.find((c) => c.userId === mine.userId) : undefined;
  const multiplier = m.result?.multiplier ?? detail.result?.multiplier ?? null;
  const expectedA = m.result?.expectedScoreA ?? detail.result?.expectedScoreA ?? null;
  const winnerChance = expectedA == null ? null : winner === "A" ? expectedA : 1 - expectedA;
  const endType = m.result?.endType ?? detail.result?.endType ?? null;
  const cupsA = m.result?.cupsRemainingA ?? detail.result?.cupsRemainingA ?? null;
  const cupsB = m.result?.cupsRemainingB ?? detail.result?.cupsRemainingB ?? null;
  const duration =
    m.timer?.startedAt != null && m.timer.endedAt != null ? elapsedOf(m.timer, m.timer.endedAt) : null;
  const unrated = !m.rated
    ? "Freundschaftsspiel: keine Elo-Änderung."
    : multiplier === 0
      ? "Wiederholung: Dieses Match zählt nicht für Elo."
      : null;
  const nameOf = new Map(players.map((p) => [p.userId, p.displayName]));

  return (
    <div className="flex flex-col gap-4">
      {mine && (
        <MyHero
          won={mine.side === winner}
          delta={myChange?.delta ?? null}
          ratingAfter={myChange?.ratingAfter ?? null}
          row={leaderboard.find((r) => r.userId === mine.userId) ?? null}
          players={leaderboard.length}
        />
      )}
      <section
        aria-label="Resultat"
        className={cn(
          "flex items-center gap-3 rounded-2xl border-2 p-4",
          winner === "A" ? "border-team-home bg-team-home/10" : "border-team-away bg-team-away/10",
        )}
      >
        <Trophy className="text-gold size-9 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-3xl leading-tight">Team {winner} gewinnt</p>
          <p className="text-foreground/85 break-words">
            {teamLabel((winner === "A" ? m.sideA : m.sideB).map((p) => p.displayName))}
          </p>
        </div>
      </section>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {endType && <li>{eloEndTypeLabel[endType]}</li>}
        {(cupsA != null || cupsB != null) && (
          <li>
            Becher übrig: A {cupsA ?? "–"} · B {cupsB ?? "–"}
          </li>
        )}
        {duration != null && <li>Spieldauer {formatElapsed(duration)}</li>}
        {winnerChance != null && m.rated && (
          <li className={cn(winnerChance < 0.35 && "text-team-away font-semibold")}>
            {winnerChance < 0.35 && <Zap className="mr-1 inline size-4" aria-hidden="true" />}
            Siegchance vorher {formatPercent(winnerChance)}
            {winnerChance < 0.35 && ": Überraschung!"}
          </li>
        )}
      </ul>
      {unrated ? (
        <p className="bg-muted/40 flex items-center gap-2 rounded-xl p-3 font-semibold">
          {m.rated ? (
            <Repeat2 className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <Handshake className="size-5 shrink-0" aria-hidden="true" />
          )}
          {unrated}
        </p>
      ) : (
        <section aria-labelledby="elo-changes" className="flex flex-col gap-2">
          <h2 id="elo-changes" className="text-2xl leading-none">
            Elo-Änderungen
          </h2>
          {multiplier != null && multiplier > 0 && multiplier < 1 && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Repeat2 className="size-4" aria-hidden="true" /> Wiederholung: zählt zu{" "}
              {Math.round(multiplier * 100)}&nbsp;%.
            </p>
          )}
          <table className="w-full border-separate border-spacing-y-1 text-left">
            <caption className="sr-only">Elo vor und nach dem Match</caption>
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="px-2 font-semibold">
                  Spieler:in
                </th>
                <th scope="col" className="px-2 text-right font-semibold">
                  Vorher
                </th>
                <th scope="col" className="px-2 text-right font-semibold">
                  ±
                </th>
                <th scope="col" className="px-2 text-right font-semibold">
                  Neu
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr
                  key={c.userId}
                  className={cn(
                    "[&>td]:bg-card [&>td]:py-2 [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl",
                    c.userId === meId && "[&>td]:bg-primary/10",
                  )}
                >
                  <td className="max-w-0 px-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <SideTag side={c.side} className="size-6 text-sm" />
                      <PlayerAvatar
                        userId={c.userId}
                        name={nameOf.get(c.userId) ?? "?"}
                        size="xs"
                        className="hidden min-[400px]:inline-flex"
                      />
                      <span className="truncate font-semibold">{nameOf.get(c.userId) ?? "?"}</span>
                    </span>
                  </td>
                  <td className="tabular text-muted-foreground px-2 text-right">
                    {formatRating(c.ratingBefore)}
                  </td>
                  <td className="px-2 text-right">
                    <DeltaText value={c.delta} />
                  </td>
                  <td className="font-display tabular px-2 text-right text-xl">
                    {formatRating(c.ratingAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canPlayAgain && (
          <Link
            href="/elo/play"
            className={cn(buttonVariants({ size: "lg", variant: "accent" }), "sm:flex-1")}
          >
            <Plus aria-hidden="true" /> Neues Match
          </Link>
        )}
        <Link
          href="/elo/rankings"
          className={cn(buttonVariants({ size: "lg", variant: "outline" }), "sm:flex-1")}
        >
          <Medal aria-hidden="true" /> Zur Rangliste
        </Link>
      </div>
    </div>
  );
}
