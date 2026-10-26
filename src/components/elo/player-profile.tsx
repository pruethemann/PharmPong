import Link from "next/link";
import {
  ChevronRight,
  Handshake,
  Medal,
  Repeat2,
  Swords,
  Trophy,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { clockTime, formatPercent, formatRating, gamesLabel, teamLabel } from "@/lib/elo-format";
import type { EloPlayerProfile } from "@/server/services/elo-read";
import { KpiTile } from "@/components/admin/kpi-tile";
import { EmptyState, PageTitle, Section } from "@/components/pp/section";
import { cn } from "@/lib/utils";
import { DeltaText, ProvisionalBadge } from "./leaderboard";
import { PlayerAvatar } from "./player-avatar";
import { RatingChart } from "./rating-chart";

/** Fewer points than this: stat tiles instead of a line chart (a line through 2–3 dots says little). */
const MIN_CHART_POINTS = 4;

function RecentMatches({ p }: { p: EloPlayerProfile }) {
  return (
    <ul className="flex flex-col gap-2">
      {p.recentMatches.map((m) => {
        const unrated = !m.rated
          ? "Freundschaftsspiel"
          : m.multiplier === 0
            ? "Wiederholung: nicht gewertet"
            : null;
        return (
          <li key={m.matchId}>
            <Link
              href={`/elo/matches/${m.matchId}`}
              className="bg-card hover:border-primary/60 flex items-center gap-3 rounded-2xl border p-3 transition-colors"
            >
              <span
                className={cn(
                  "font-display flex size-10 shrink-0 items-center justify-center rounded-xl text-lg",
                  m.won ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {m.won ? "S" : "N"}
                <span className="sr-only">{m.won ? "Sieg" : "Niederlage"}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {m.teammates.length > 0 ? `mit ${teamLabel(m.teammates)} ` : "solo "}
                  gegen {teamLabel(m.opponents)}
                </span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
                  <span>
                    Tisch {m.tableNumber} · {clockTime(m.at)}
                  </span>
                  {unrated && (
                    <span className="inline-flex items-center gap-1">
                      {m.rated ? (
                        <Repeat2 className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Handshake className="size-3.5" aria-hidden="true" />
                      )}
                      {unrated}
                    </span>
                  )}
                </span>
              </span>
              {m.delta != null && !unrated && <DeltaText value={m.delta} />}
              <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function People({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: typeof Users;
  rows: { userId: string; displayName: string; matches: number; won?: number }[];
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="bg-card flex flex-col divide-y rounded-2xl border">
        {rows.slice(0, 5).map((r) => (
          <li key={r.userId}>
            <Link
              href={`/elo/players/${r.userId}`}
              className="hover:bg-muted/40 flex min-h-14 items-center gap-3 px-3 py-2"
            >
              <PlayerAvatar userId={r.userId} name={r.displayName} size="sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.displayName}</span>
              <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Icon className="size-4" aria-hidden="true" />
                {r.won != null ? `${r.won} von ${r.matches} gewonnen` : `${gamesLabel(r.matches)} zusammen`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Elo profile of one player in the current round: rating, rank, progression, matches, partners. */
export function PlayerProfile({ profile: p, isMe }: { profile: EloPlayerProfile; isMe: boolean }) {
  const points = [
    { label: "Start", rating: p.initialRating },
    ...p.history.map((h, i) => ({ label: `Match ${i + 1} (${clockTime(h.at)})`, rating: h.ratingAfter })),
  ];
  const change = p.rating - p.initialRating;
  return (
    <>
      <div className="flex items-center gap-4 pt-2">
        <PlayerAvatar userId={p.userId} name={p.displayName} size="xl" />
        <div className="min-w-0 flex-1">
          <PageTitle
            kicker={p.session ? `Elo-Profil · ${p.session.name}` : "Elo-Profil"}
            title={isMe ? `${p.displayName} (du)` : p.displayName}
          />
        </div>
      </div>
      {!p.session ? (
        <EmptyState icon={<Medal />} title="Noch keine Elo-Runde">
          <p>Sobald die Turnierleitung eine Elo-Runde eröffnet, erscheinen hier Punkte und Matches.</p>
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile
              icon={change >= 0 ? TrendingUp : TrendingDown}
              label="Elo"
              value={
                <span className="font-display tabular text-4xl leading-none">{formatRating(p.rating)}</span>
              }
              sub={<DeltaText value={change} className="text-sm" />}
            />
            <KpiTile
              icon={Trophy}
              label="Rang"
              value={
                <span className="font-display tabular text-4xl leading-none">
                  {p.rank ?? "–"}
                  {p.rank != null && <span className="text-muted-foreground text-xl">/{p.players}</span>}
                </span>
              }
              sub={p.provisional ? <ProvisionalBadge /> : p.eligible ? "titelberechtigt" : undefined}
            />
            <KpiTile
              icon={Swords}
              label="Bilanz"
              value={
                <span className="font-display tabular text-4xl leading-none">
                  {p.wins}–{p.losses}
                </span>
              }
              sub={
                p.gamesPlayed > 0 ? `${formatPercent(p.wins / p.gamesPlayed)} Siegquote` : "noch kein Match"
              }
            />
            <KpiTile
              icon={TrendingUp}
              label="Bestwert"
              value={
                <span className="font-display tabular text-4xl leading-none">
                  {formatRating(p.peakRating)}
                </span>
              }
              sub={`Tiefstwert ${formatRating(p.lowestRating)}`}
            />
          </div>
          {p.provisional && p.minGamesForChampion > 0 && (
            <p className="text-muted-foreground text-sm">
              Vorläufig: Ab {p.minGamesForChampion} gewerteten Spielen zählt {isMe ? "dein" : "der"} Platz für
              den Titel ({p.gamesPlayed} von {p.minGamesForChampion}).
            </p>
          )}
          <Section title="Verlauf">
            {points.length >= MIN_CHART_POINTS ? (
              <div className="bg-card rounded-2xl border p-4">
                <RatingChart points={points} initialRating={p.initialRating} />
              </div>
            ) : (
              <p className="bg-card text-muted-foreground rounded-2xl border p-4">
                {p.history.length === 0
                  ? "Noch kein gewertetes Match."
                  : `Erst ${gamesLabel(p.history.length)} gewertet: Ab 3 Matches erscheint hier die Kurve.`}
              </p>
            )}
          </Section>
          {p.recentMatches.length > 0 && (
            <Section title="Letzte Matches">
              <RecentMatches p={p} />
            </Section>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            <People title="Oft im Team mit" icon={Users} rows={p.teammates} />
            <People title="Oft gegen" icon={Swords} rows={p.opponents} />
          </div>
        </>
      )}
    </>
  );
}
