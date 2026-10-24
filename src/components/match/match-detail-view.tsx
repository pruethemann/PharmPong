"use client";

import { useEffect, useRef, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Crown,
  Flag,
  Gavel,
  Hourglass,
  RefreshCw,
  Settings2,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { EmptyState } from "@/components/pp/section";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { endTypeLabel, type RoleKey } from "@/lib/i18n/de";
import type { LiveTeam, PublicSnapshot } from "@/lib/live-types";
import { useLive, type Connection } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import type { MatchDetail, MatchDetailTeam, MatchTimelineEntry } from "@/server/services/match-detail";
import { SafeBigTimer } from "./safe-timer";

type Live = { endpoint: "/api/live" | "/api/live/public"; initial: PublicSnapshot };

const zurich = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});
const zurichDay = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const time = (ms: number) => zurich.format(new Date(ms));

export function MatchDetailView({
  detail,
  live,
  role,
}: {
  detail: MatchDetail;
  live: Live | null;
  role: RoleKey | null;
}) {
  return live ? (
    <LiveMatchDetail detail={detail} live={live} role={role} />
  ) : (
    <StaticMatchDetail detail={detail} role={role} />
  );
}

function LiveMatchDetail({ detail, live, role }: { detail: MatchDetail; live: Live; role: RoleKey | null }) {
  const router = useRouter();
  const { data, connection, clockOffsetMs } = useLive<PublicSnapshot>({
    endpoint: live.endpoint,
    initial: live.initial,
  });
  const m = data?.matches.find((x) => x.id === detail.id) ?? null;
  const team = (id: string | null, fallback: MatchDetailTeam | null): MatchDetailTeam | null => {
    if (!id) return null;
    const t: LiveTeam | undefined = data?.teams.find((x) => x.id === id);
    return t ?? (fallback?.id === id ? fallback : null);
  };

  const merged: MatchDetail = m
    ? {
        ...detail,
        status: m.status,
        tableNumber: m.tableNumber,
        home: team(m.homeTeamId, detail.home),
        away: team(m.awayTeamId, detail.away),
        result: m.result,
        timer: m.timer,
      }
    : detail;

  // When the match changed on the server, reload the server-rendered part (timeline).
  const key = m
    ? `${m.status}|${m.homeTeamId}|${m.awayTeamId}|${JSON.stringify(m.result)}|${m.timer?.pausedAt}`
    : "";
  const firstKey = useRef(key);
  useEffect(() => {
    if (key && key !== firstKey.current) {
      firstKey.current = key;
      router.refresh();
    }
  }, [key, router]);

  return (
    <MatchDetailBody
      d={merged}
      role={role}
      clockOffsetMs={clockOffsetMs}
      status={<ConnectionBadge state={connection as Connection} />}
    />
  );
}

function StaticMatchDetail({ detail, role }: { detail: MatchDetail; role: RoleKey | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <MatchDetailBody
      d={detail}
      role={role}
      clockOffsetMs={0}
      status={
        <Button variant="outline" onClick={() => start(() => router.refresh())} disabled={pending}>
          <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : undefined} />
          {pending ? "Lädt …" : "Aktualisieren"}
        </Button>
      }
    />
  );
}

// ─── Body ──────────────────────────────────────────────────────────────────

function MatchDetailBody({
  d,
  role,
  clockOffsetMs,
  status,
}: {
  d: MatchDetail;
  role: RoleKey | null;
  clockOffsetMs: number;
  status: ReactNode;
}) {
  const decided = d.status === "COMPLETED" || d.status === "FORFEITED";
  const winnerId = d.result?.winnerTeamId ?? null;
  const isReferee = role === "REFEREE" || role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/tournament"
          className="text-muted-foreground hover:text-foreground -ml-2 inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 font-semibold"
        >
          <ArrowLeft className="size-5" aria-hidden="true" /> Turnier
        </Link>
        {status}
      </div>

      <header className="flex flex-col gap-3">
        <p className="font-display text-primary text-sm tracking-widest">
          Spiel {d.code}
          {d.stage === "GROUP" && d.group ? ` · Gruppe ${d.group}` : " · K.-o.-Phase"}
        </p>
        <h1 className="text-4xl leading-none break-words sm:text-6xl">{d.label}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={d.status} size="lg" />
          {d.tableNumber != null && <TableBadge number={d.tableNumber} size="md" />}
        </div>
      </header>

      {d.status === "IN_PROGRESS" && d.timer && (
        <section
          aria-label="Spielzeit"
          className="bg-card border-status-live/60 flex flex-col items-center gap-2 rounded-3xl border p-5 shadow-[0_0_0_1px_var(--live)]"
        >
          <p className="font-display text-status-live text-sm tracking-widest">
            Live{d.tableNumber != null ? ` an Tisch ${d.tableNumber}` : ""}
          </p>
          <SafeBigTimer timer={d.timer} clockOffsetMs={clockOffsetMs} size="lg" />
        </section>
      )}
      {d.status === "AWAITING_CONFIRMATION" && (
        <p
          role="status"
          className="border-status-awaiting/60 bg-status-awaiting/10 text-status-awaiting flex items-start gap-3 rounded-2xl border p-4 font-semibold"
        >
          <Hourglass className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          Das Resultat ist erfasst und wird gerade von der Schiedsrichter:in kontrolliert.
        </p>
      )}

      <section aria-label="Teams" className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <TeamPanel
          team={d.home}
          placeholder={d.homeSourceLabel}
          side="home"
          winnerId={winnerId}
          decided={decided}
        />
        <div className="flex items-center justify-center" aria-hidden="true">
          <span className="font-display text-muted-foreground bg-muted inline-flex size-12 items-center justify-center rounded-full text-lg">
            vs
          </span>
        </div>
        <TeamPanel
          team={d.away}
          placeholder={d.awaySourceLabel}
          side="away"
          winnerId={winnerId}
          decided={decided}
        />
      </section>

      {decided && d.result && <ResultBlock d={d} />}

      {d.stage === "KNOCKOUT" && !decided && d.nextLabel && (
        <p className="text-muted-foreground flex items-center gap-2">
          <Swords className="size-5 shrink-0" aria-hidden="true" />
          Der Sieger zieht in den {d.nextLabel} ein.
        </p>
      )}

      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="text-2xl leading-none">
          Verlauf
        </h2>
        <Timeline entries={d.timeline} />
      </section>

      <nav
        aria-label="Weitere Ansichten"
        className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:flex-wrap"
      >
        <Link href="/tournament" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <Trophy aria-hidden="true" /> Zum Turnier
        </Link>
        {isReferee && (
          <Link href="/referee" className={buttonVariants({ variant: "default", size: "lg" })}>
            <Gavel aria-hidden="true" /> Im Schiri-Modus öffnen
          </Link>
        )}
        {role === "ADMIN" && (
          <Link
            href={`/admin/matches?match=${encodeURIComponent(d.id)}`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Settings2 aria-hidden="true" /> In der Verwaltung öffnen
          </Link>
        )}
      </nav>
    </div>
  );
}

function TeamPanel({
  team,
  placeholder,
  side,
  winnerId,
  decided,
}: {
  team: MatchDetailTeam | null;
  placeholder: string | null;
  side: "home" | "away";
  winnerId: string | null;
  decided: boolean;
}) {
  const sideLabel = side === "home" ? "Team A" : "Team B";
  const sideText = side === "home" ? "text-team-home" : "text-team-away";
  if (!team) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-5 text-center">
        <span className={cn("font-display text-sm tracking-widest", sideText)}>{sideLabel}</span>
        <span className="font-display text-muted-foreground text-3xl leading-none">
          {placeholder ?? "Offen"}
        </span>
        <span className="text-muted-foreground text-sm">
          {placeholder?.startsWith("Sieger")
            ? "Steht fest, sobald das Vorspiel bestätigt ist."
            : "Steht fest, sobald die Gruppe abgeschlossen ist."}
        </span>
      </div>
    );
  }
  const isWinner = decided && winnerId === team.id;
  const isLoser = decided && !!winnerId && winnerId !== team.id;
  return (
    <article
      aria-label={`${sideLabel}: ${team.name}${isWinner ? ", Sieger" : ""}`}
      className={cn(
        "bg-card flex min-w-0 flex-col items-center gap-3 rounded-3xl border-2 p-5 text-center",
        side === "home" ? "border-team-home/50" : "border-team-away/50",
        isWinner && "border-gold ring-gold/40 ring-4",
        isLoser && "opacity-75",
      )}
    >
      <span className={cn("font-display text-sm tracking-widest", sideText)}>{sideLabel}</span>
      <TeamAvatar name={team.name} logoUrl={team.logoUrl} side={side} size="xl" />
      <h2 className="text-3xl leading-none break-words sm:text-4xl">{team.name}</h2>
      {isWinner && (
        <span className="font-display text-gold bg-gold/15 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-lg">
          <Trophy className="size-5" aria-hidden="true" /> Sieger
        </span>
      )}
      {team.motto && <p className="text-muted-foreground text-lg italic">«{team.motto}»</p>}
      {team.members.length > 0 && (
        <ul aria-label="Mitglieder" className="flex flex-wrap justify-center gap-2">
          {team.members.map((name) => (
            <li
              key={name}
              className="bg-muted inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
            >
              <UserRound className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ResultBlock({ d }: { d: MatchDetail }) {
  const r = d.result!;
  const winner = r.winnerTeamId === d.home?.id ? d.home : r.winnerTeamId === d.away?.id ? d.away : null;
  const forfeit = r.endType === "FORFEIT";
  const scored = (side: "home" | "away") =>
    10 - (side === "home" ? r.awayCupsRemaining : r.homeCupsRemaining);
  const isFinal = d.stage === "KNOCKOUT" && !d.nextCode;
  return (
    <section aria-labelledby="result-title" className="bg-card flex flex-col gap-4 rounded-3xl border p-5">
      <h2 id="result-title" className="text-2xl leading-none">
        Resultat
      </h2>
      <div className="flex flex-col items-center gap-2 text-center">
        {isFinal ? (
          <Crown className="text-gold size-12" aria-hidden="true" />
        ) : (
          <Trophy className="text-gold size-10" aria-hidden="true" />
        )}
        <p className="font-display text-3xl leading-none break-words sm:text-4xl">
          {winner?.name ?? "Sieger"} {isFinal ? "ist Champion" : "gewinnt"}
        </p>
        <p
          className="font-display tabular flex items-baseline gap-3 text-6xl leading-none"
          aria-label={`${r.homeCupsRemaining} zu ${r.awayCupsRemaining} Becher übrig`}
        >
          <span className="text-team-home">{r.homeCupsRemaining}</span>
          <span className="text-muted-foreground text-4xl">:</span>
          <span className="text-team-away">{r.awayCupsRemaining}</span>
        </p>
        <p className="text-muted-foreground text-sm">Becher übrig (Team A : Team B)</p>
        <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
          {forfeit && <Flag className="size-4" aria-hidden="true" />}
          {endTypeLabel[r.endType]}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {(["home", "away"] as const).map((side) => {
          const t = side === "home" ? d.home : d.away;
          return (
            <div
              key={side}
              className={cn(
                "bg-muted/50 flex min-w-0 flex-col gap-1 rounded-2xl border-l-4 p-3",
                side === "home" ? "border-team-home" : "border-team-away",
              )}
            >
              <dt className="flex min-w-0 flex-col text-sm">
                <span className="text-muted-foreground">Erzielte Becher</span>
                <span className="truncate font-semibold">
                  {t?.name ?? (side === "home" ? "Team A" : "Team B")}
                </span>
              </dt>
              <dd className="font-display tabular text-4xl leading-none">{scored(side)}</dd>
            </div>
          );
        })}
      </dl>
      {r.endType === "SHOOTOUT" && (
        <p className="text-muted-foreground text-sm">
          Gleichstand nach Zeitablauf: Entschieden im Shootout. Shootout-Treffer zählen nicht zur
          Becherstatistik.
        </p>
      )}
      {forfeit && (
        <p className="text-muted-foreground text-sm">Forfait: Das Spiel wird mit 10 : 0 Bechern gewertet.</p>
      )}
      {(d.startedAt || d.confirmedAt) && (
        <p className="text-muted-foreground text-sm">
          {d.startedAt
            ? `Gestartet ${zurichDay.format(new Date(d.startedAt))}, ${time(d.startedAt)} Uhr`
            : ""}
          {d.startedAt && d.confirmedAt ? " · " : ""}
          {d.confirmedAt ? `bestätigt ${time(d.confirmedAt)} Uhr` : ""}
        </p>
      )}
      {d.stage === "KNOCKOUT" && d.nextLabel && winner && (
        <p className="bg-primary/10 text-primary font-display inline-flex items-center gap-2 self-center rounded-full px-4 py-1.5 text-lg">
          <Swords className="size-5" aria-hidden="true" /> {winner.name} weiter in {d.nextLabel}
        </p>
      )}
    </section>
  );
}

const TONE: Record<MatchTimelineEntry["tone"], string> = {
  neutral: "bg-muted-foreground",
  live: "bg-status-live",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
  gold: "bg-gold",
};

function Timeline({ entries }: { entries: MatchTimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState title="Noch nichts passiert">
        Sobald das Spiel auf einen Tisch kommt, steht es hier.
      </EmptyState>
    );
  }
  return (
    <ol className="bg-card flex flex-col rounded-3xl border p-2">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 px-3 py-3">
          <div className="flex w-12 shrink-0 flex-col items-end">
            <time dateTime={new Date(e.at).toISOString()} className="tabular text-muted-foreground text-sm">
              {time(e.at)}
            </time>
          </div>
          <div className="relative flex flex-col items-center" aria-hidden="true">
            <span className={cn("mt-1.5 size-3 rounded-full", TONE[e.tone])} />
            {i < entries.length - 1 && <span className="bg-border absolute top-5 -bottom-4 w-px" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{e.label}</span>
            {e.detail && <span className="text-muted-foreground text-sm break-words">{e.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
