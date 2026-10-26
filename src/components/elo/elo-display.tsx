"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Ban, Coffee, Crown, Flame, Hourglass, Pause, QrCode, TrendingUp, Trophy, Zap } from "lucide-react";
import { formatDelta, formatPercent, ratingLabels, teamLabel } from "@/lib/elo-format";
import { eloSessionStatusLabel } from "@/lib/i18n/de-elo";
import type { EloLiveMatch, EloLiveTable, EloPublicSnapshot, EloSideKey } from "@/lib/elo-live-types";
import { useLive } from "@/lib/use-live";
import { BubblingFlask } from "@/components/display/champion-takeover";
import { useNow } from "@/components/display/use-now";
import { ClientOnly } from "@/components/live/client-only";
import { zurichTime } from "@/components/live/live-view";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { LogoMark } from "@/components/pp/logo";
import { TableBadge } from "@/components/pp/table-badge";
import { cn } from "@/lib/utils";
import { sideDelta, unratedReason } from "./elo-match-row";
import { EloStatusPill, eloPillKey } from "./elo-status-pill";
import { PlayerAvatar } from "./player-avatar";
import { Stopwatch } from "./stopwatch";

// Sizes in `em` of the display root (≈ 1 % of the screen width, 19.2 px at 1080p), like DisplayScreen.
const ROOT_FONT = "min(1vw, 1.7778vh)";
const TOP = 10;

function Clock({ offsetMs }: { offsetMs: number }) {
  const now = useNow();
  return (
    <span className="font-display tabular text-[2.6em] leading-none" aria-label="Uhrzeit">
      {now == null ? "--:--" : zurichTime(now + offsetMs)}
    </span>
  );
}

function Side({ side, m }: { side: EloSideKey; m: EloLiveMatch }) {
  const players = side === "A" ? m.sideA : m.sideB;
  return (
    <div className="flex min-w-0 items-center gap-[0.8em]">
      <span
        className={cn(
          "font-display flex size-[1.6em] shrink-0 items-center justify-center rounded-[0.3em] text-[2em]",
          side === "A" ? "bg-team-home text-team-home-foreground" : "bg-team-away text-team-away-foreground",
        )}
        aria-hidden="true"
      >
        {side}
      </span>
      <span className="font-display line-clamp-2 min-w-0 text-[2.6em] leading-[1.05] break-words">
        <span className="sr-only">Team {side}: </span>
        {teamLabel(players.map((p) => p.displayName))}
      </span>
    </div>
  );
}

function TablePanel({
  table,
  match,
  clockOffsetMs,
  reminder,
}: {
  table: EloLiveTable;
  match: EloLiveMatch | null;
  clockOffsetMs: number;
  reminder: number | null;
}) {
  if (!match) {
    const disabled = table.state === "DISABLED";
    return (
      <article className="bg-card/60 flex flex-col items-center justify-center gap-[1.2em] rounded-[1.2em] border-[0.12em] border-dashed p-[1.5em] text-center">
        <TableBadge number={table.number} muted className="text-[2.6em]" />
        <p className="text-muted-foreground flex items-center gap-[0.4em] text-[2.4em] font-semibold">
          {disabled ? (
            <Ban className="size-[1em]" aria-hidden="true" />
          ) : (
            <Coffee className="size-[1em]" aria-hidden="true" />
          )}
          {disabled ? "Gesperrt" : "Frei"}
        </p>
        {!disabled && (
          <p className="text-foreground/85 flex items-center gap-[0.5em] text-[1.8em]">
            <QrCode className="text-accent size-[1.2em]" aria-hidden="true" /> QR-Code am Tisch scannen und
            losspielen
          </p>
        )}
      </article>
    );
  }
  const status = eloPillKey(match);
  return (
    <article
      className={cn(
        "bg-card flex min-h-0 flex-col gap-[0.8em] rounded-[1.2em] border-[0.12em] p-[1.2em]",
        status === "IN_PROGRESS" && "border-status-live/80",
      )}
    >
      <div className="flex items-center justify-between gap-[1em]">
        <TableBadge number={table.number} className="text-[2.2em]" />
        <EloStatusPill status={status} className="text-[1.6em]" />
      </div>
      <Side side="A" m={match} />
      <p className="font-display text-muted-foreground text-center text-[1.6em]" aria-hidden="true">
        vs
      </p>
      <Side side="B" m={match} />
      <div className="mt-auto flex justify-center">
        {match.status === "IN_PROGRESS" && match.timer ? (
          <ClientOnly fallback={<div className="h-[7em]" aria-hidden="true" />}>
            <Stopwatch
              timer={match.timer}
              clockOffsetMs={clockOffsetMs}
              reminderMinutes={reminder}
              size="display"
            />
          </ClientOnly>
        ) : (
          <p className="text-status-assigned flex items-center gap-[0.4em] text-[1.8em] font-semibold">
            <Hourglass className="size-[1em]" aria-hidden="true" />
            {match.consentA && match.consentB ? "Bereit zum Anpfiff" : "Aufstellung wird bestätigt"}
          </p>
        )}
      </div>
    </article>
  );
}

function Leaderboard({ data }: { data: EloPublicSnapshot }) {
  const rows = data.leaderboard.slice(0, TOP);
  const labels = ratingLabels(rows.map((r) => r.rating));
  const champions = new Set(
    data.session?.status === "CLOSED" ? data.session.champions.map((c) => c.userId) : [],
  );
  return (
    <section
      aria-label="Rangliste"
      className="bg-card flex min-h-0 flex-col gap-[0.6em] rounded-[1.2em] border p-[1em]"
    >
      <h2 className="text-[2.2em] leading-none">Rangliste</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[1.6em]">Noch keine bestätigten Matches.</p>
      ) : (
        <ol className="flex min-h-0 flex-col gap-[0.25em]">
          {rows.map((r, i) => (
            <li
              key={r.userId}
              className={cn(
                "flex items-center gap-[0.6em] rounded-[0.5em] px-[0.5em] py-[0.2em]",
                i === 0 && "bg-gold/10",
              )}
            >
              <span className="font-display tabular w-[1.6em] shrink-0 text-center text-[1.9em] leading-none">
                {champions.has(r.userId) ? (
                  <Crown className="text-gold mx-auto size-[1em]" aria-label={`Champion, Rang ${r.rank}`} />
                ) : (
                  r.rank
                )}
              </span>
              <PlayerAvatar
                userId={r.userId}
                name={r.displayName}
                className="size-[2.4em] text-[1em] ring-[0.1em]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[1.6em] leading-tight font-semibold">
                  {r.displayName}
                </span>
                <span className="text-muted-foreground block text-[1.05em]">
                  {r.gamesPlayed} {r.gamesPlayed === 1 ? "Spiel" : "Spiele"} · {r.wins}–{r.losses}
                  {r.provisional && " · vorläufig"}
                </span>
              </span>
              <span className="font-display tabular text-[2.2em] leading-none">{labels[i]}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Recent({ data }: { data: EloPublicSnapshot }) {
  const recent = data.recentMatches.slice(0, 3);
  return (
    <section
      aria-label="Letzte Resultate"
      className="bg-card flex min-h-0 flex-col gap-[0.6em] rounded-[1.2em] border p-[1em]"
    >
      <h2 className="text-[2em] leading-none">Letzte Resultate</h2>
      {recent.length === 0 ? (
        <p className="text-muted-foreground text-[1.5em]">Noch keine Resultate.</p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-[0.6em] overflow-hidden">
          {recent.map((m) => {
            const w = m.result?.winnerSide ?? "A";
            const winners = w === "A" ? m.sideA : m.sideB;
            const losers = w === "A" ? m.sideB : m.sideA;
            const dw = sideDelta(m, winners);
            const dl = sideDelta(m, losers);
            const note = unratedReason(m);
            return (
              <li key={m.id} className="flex flex-col text-[1.4em] leading-[1.3]">
                <span className="flex items-center gap-[0.4em]">
                  <Trophy className="text-gold size-[1em] shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {teamLabel(winners.map((p) => p.displayName))}
                  </span>
                  {dw != null && !note && (
                    <span className="tabular text-success font-semibold">{formatDelta(dw)}</span>
                  )}
                </span>
                <span className="text-muted-foreground flex items-center gap-[0.4em] pl-[1.4em]">
                  <span className="min-w-0 flex-1 truncate">
                    gegen {teamLabel(losers.map((p) => p.displayName))}
                  </span>
                  {note ? (
                    <span className="shrink-0 text-[0.85em]">{note}</span>
                  ) : (
                    dl != null && <span className="tabular text-destructive">{formatDelta(dl)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Awards({ data }: { data: EloPublicSnapshot }) {
  const a = data.achievements;
  const items = [
    {
      icon: Flame,
      tone: "text-warning",
      title: "Am aktivsten",
      v: a.mostActive,
      detail: (n: number) => `${n} Matches`,
    },
    {
      icon: Zap,
      tone: "text-team-away",
      title: "Grösste Überraschung",
      v: a.biggestUpset,
      detail: (n: number) => `Sieg mit ${formatPercent(n)} Chance`,
    },
    {
      icon: TrendingUp,
      tone: "text-accent",
      title: "Bestes Comeback",
      v: a.bestComeback,
      detail: (n: number) => `+${n.toFixed(1)} Elo`,
    },
  ];
  return (
    <section
      aria-label="Auszeichnungen"
      className="bg-card flex min-h-0 flex-col gap-[0.8em] rounded-[1.2em] border p-[1em]"
    >
      <h2 className="text-[2em] leading-none">Auszeichnungen</h2>
      <ul className="flex flex-col gap-[0.6em]">
        {items.map(({ icon: Icon, tone, title, v, detail }) => (
          <li key={title} className="flex items-center gap-[0.8em]">
            <Icon
              className={cn("size-[2.2em] shrink-0", v ? tone : "text-muted-foreground")}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="text-muted-foreground block truncate text-[1.1em] font-semibold tracking-wide uppercase">
                {title}
                {v && <span className="tracking-normal normal-case"> · {detail(v.value)}</span>}
              </span>
              <span className="font-display block truncate text-[1.7em] leading-tight">
                {v ? teamLabel(v.names) : "–"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChampionFinale({ data }: { data: EloPublicSnapshot }) {
  const s = data.session!;
  const top = data.leaderboard.filter((r) => s.champions.some((c) => c.userId === r.userId));
  const co = s.champions.length > 1;
  return (
    <section
      aria-label={co ? "Elo-Champions" : "Elo-Champion"}
      className="animate-pop-in bg-background absolute inset-0 z-40 flex items-center justify-center overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(60em_35em_at_50%_40%,color-mix(in_oklch,var(--gold)_22%,transparent),transparent_70%)]"
      />
      <div className="relative flex items-center gap-[5em]">
        <BubblingFlask />
        <div className="flex max-w-[64em] flex-col items-center gap-[1.2em] text-center">
          <p className="font-display text-gold flex items-center gap-[0.4em] text-[3em] tracking-widest">
            <Trophy className="size-[1em]" aria-hidden="true" /> {co ? "Elo-Champions" : "Elo-Champion"} ·{" "}
            {s.name}
          </p>
          <div className="flex -space-x-[1.5em]">
            {s.champions.map((c) => (
              <PlayerAvatar
                key={c.userId}
                userId={c.userId}
                name={c.displayName}
                className="ring-gold animate-glow size-[2.4em] text-[4em] ring-[0.06em]"
              />
            ))}
          </div>
          <h1 className="text-[6.5em] leading-[0.95] break-words">
            {teamLabel(s.champions.map((c) => c.displayName))}
          </h1>
          {top[0] && (
            <p className="text-foreground/85 text-[2.2em]">
              <span className="font-display tabular">{Math.round(top[0].rating)}</span> Elo · {top[0].wins}{" "}
              Siege aus {top[0].gamesPlayed} Spielen
            </p>
          )}
          <p className="text-muted-foreground text-[1.7em]">
            {data.stats.completed} Matches · {data.stats.players} Spieler:innen · Danke fürs Mitspielen!
          </p>
        </div>
      </div>
    </section>
  );
}

const SHARING_CHECK_MS = 20_000;

/** When public sharing is switched off, the endpoint answers 404: re-render the server page. */
function useSharingWatch(revision: number) {
  const router = useRouter();
  const rev = useRef(revision);
  useEffect(() => {
    rev.current = revision;
  }, [revision]);
  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/elo/live/public?since=${rev.current}`, { cache: "no-store" });
        if (!stopped && res.status === 404) router.refresh();
      } catch {
        // Network down: the connection badge already says so.
      }
    }, SHARING_CHECK_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router]);
}

/** Projector view in Elo Mode: both tables with stopwatches, ranking, latest results, awards. */
export function EloDisplayScreen({ initial }: { initial: EloPublicSnapshot }) {
  const {
    data: live,
    connection,
    clockOffsetMs,
  } = useLive<EloPublicSnapshot>({
    endpoint: "/api/elo/live/public",
    initial,
  });
  const data = live ?? initial;
  useSharingWatch(data.revision);
  const s = data.session;
  const byTable = new Map(data.liveMatches.map((m) => [m.tableId, m]));
  const tables = data.tables.slice(0, 2);
  const pending = data.pendingMatches.length;
  return (
    <div
      className="bg-background relative flex h-dvh w-full flex-col gap-[1em] overflow-hidden p-[1.2em]"
      style={{ fontSize: ROOT_FONT }}
    >
      <header className="flex items-center justify-between gap-[2em]">
        <div className="flex min-w-0 items-center gap-[1.2em]">
          <LogoMark title="" className="size-[3.6em]" />
          <span className="font-display text-[2.8em] leading-none whitespace-nowrap">
            Pharma<span className="text-primary">Pong</span>
          </span>
          <span className="text-accent font-display truncate text-[1.8em] tracking-widest">
            Elo-Modus{s ? ` · ${s.name}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-[1.6em]">
          {pending > 0 && (
            <span className="border-warning/70 text-warning inline-flex items-center gap-[0.4em] rounded-full border-[0.1em] px-[0.8em] py-[0.3em] text-[1.4em] font-semibold">
              <Hourglass className="size-[1em]" aria-hidden="true" /> {pending}{" "}
              {pending === 1 ? "Resultat offen" : "Resultate offen"}
            </span>
          )}
          {s && s.status !== "OPEN" && (
            <span className="bg-warning text-warning-foreground font-display inline-flex items-center gap-[0.4em] rounded-full px-[0.8em] py-[0.3em] text-[1.6em]">
              <Pause className="size-[1em]" aria-hidden="true" /> {eloSessionStatusLabel[s.status]}
            </span>
          )}
          <Clock offsetMs={clockOffsetMs} />
          <ConnectionBadge state={connection} className="text-[1.1em] [&_svg]:size-[1.2em]" />
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_36em] gap-[1em]">
        <div className="flex min-h-0 flex-col gap-[1em]">
          <section aria-label="Tische" className="grid h-[30em] shrink-0 grid-cols-2 gap-[1em]">
            {tables.map((t) => (
              <TablePanel
                key={t.id}
                table={t}
                match={byTable.get(t.id) ?? null}
                clockOffsetMs={clockOffsetMs}
                reminder={s?.settings.softReminderMinutes ?? null}
              />
            ))}
          </section>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[1em]">
            <Recent data={data} />
            <Awards data={data} />
          </div>
        </div>
        <Leaderboard data={data} />
      </main>
      {s?.status === "CLOSED" && s.champions.length > 0 && <ChampionFinale data={data} />}
    </div>
  );
}
