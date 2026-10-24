"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  GitFork,
  Hourglass,
  KeyRound,
  LogIn,
  MapPin,
  Play,
  Sparkles,
  Swords,
  UserPlus,
  Users,
} from "lucide-react";
import { sourceLabel } from "@/lib/live-labels";
import type { LiveMatch } from "@/lib/live-types";
import type { Connection } from "@/lib/use-live";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { LogoMark } from "@/components/pp/logo";
import { MatchCard } from "@/components/pp/match-card";
import { EmptyState, Section } from "@/components/pp/section";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Bracket } from "@/components/bracket/bracket";
import { GroupStandings, GroupStatusLine } from "@/components/standings/group-standings";
import { cn } from "@/lib/utils";
import { LiveSource } from "./live-source";
import { LiveTableCard } from "./live-table-card";
import {
  indexSnapshot,
  matchesAhead,
  playedCount,
  tableMatch,
  teamOf,
  toCardData,
  type AnySnapshot,
  type LiveMode,
  type SnapshotIndex,
  type Viewer,
} from "./live-view";
import { StaticNote } from "./static-note";
import { ChampionBanner, PauseBanner, PhaseChip } from "./tournament-status";

function Hero({ data, connection }: { data: AnySnapshot; connection: Connection | null }) {
  const { done, total } = playedCount(data);
  const t = data.tournament;
  const started = total > 0;
  return (
    <section
      aria-label="Turnierstatus"
      className="bg-card relative isolate overflow-hidden rounded-3xl border p-5 sm:p-8"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(28rem_16rem_at_100%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_70%),radial-gradient(24rem_14rem_at_0%_100%,color-mix(in_oklch,var(--team-away)_14%,transparent),transparent_70%)]"
      />
      <LogoMark
        title=""
        className="text-foreground absolute -right-10 -bottom-10 -z-10 size-44 rotate-12 opacity-[0.08] sm:size-64"
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-primary text-sm tracking-widest">Pharmazentrum · Uni Basel</p>
          {connection && <ConnectionBadge state={connection} />}
        </div>
        <h1 className="text-5xl leading-[0.9] sm:text-7xl">
          {t.name === "PharmaPong" ? (
            <>
              Pharma<span className="text-primary">Pong</span>
            </>
          ) : (
            t.name
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <PhaseChip status={t.status} />
        </div>
        {started ? (
          <div className="flex max-w-md flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Spiele gespielt</span>
              <span className="font-display tabular text-xl leading-none">
                {done}
                <span className="text-muted-foreground">/{total}</span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Turnierfortschritt"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              className="bg-muted h-2 overflow-hidden rounded-full"
            >
              <div
                className="from-primary to-accent h-full rounded-full bg-gradient-to-r"
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2">
            <Users className="size-5" aria-hidden="true" />
            <span>
              <span className="font-display tabular text-foreground text-2xl">{data.teams.length}</span>
              <span className="text-muted-foreground">/12</span> Teams angemeldet
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function aheadText(n: number): string {
  if (n === 0) return "Ihr seid als Nächstes dran!";
  if (n === 1) return "In ca. 1 Spiel seid ihr dran";
  return `In ca. ${n} Spielen seid ihr dran`;
}

function MyNextMatch({ data, idx }: { data: AnySnapshot; idx: SnapshotIndex }) {
  const me = data.me;
  if (!me) return null;
  if (me.role !== "PLAYER" && !me.teamId) return null;
  if (!me.teamId) {
    const open = data.tournament.status === "REGISTRATION_OPEN";
    return (
      <Section title="Mein Team">
        <div className="bg-card flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-2xl leading-tight">Du hast noch kein Team</p>
            <p className="text-muted-foreground">
              {open
                ? "Gründe ein Team oder tritt mit einem Einladungscode bei."
                : "Die Anmeldung ist geschlossen. Melde dich bei der Turnierleitung."}
            </p>
          </div>
          {open && (
            <Link href="/team" className={buttonVariants({ size: "lg" })}>
              <UserPlus aria-hidden="true" /> Team gründen oder beitreten
            </Link>
          )}
        </div>
      </Section>
    );
  }
  const myTeam = teamOf(idx, me.teamId);
  const match = data.myNextMatchId ? (idx.matchById.get(data.myNextMatchId) ?? null) : null;
  if (!match) {
    const champion = data.tournament.championTeamId === me.teamId;
    const status = data.tournament.status;
    return (
      <Section title={data.matches.length > 0 ? "Mein nächstes Spiel" : "Mein Team"}>
        <div className="bg-card flex items-center gap-4 rounded-2xl border p-5">
          {myTeam && <TeamAvatar name={myTeam.name} logoUrl={myTeam.logoUrl} size="lg" />}
          <div className="min-w-0">
            <p className="font-display truncate text-2xl leading-tight">{myTeam?.name ?? "Dein Team"}</p>
            <p className="text-muted-foreground">
              {champion
                ? "Ihr seid Champion! Gratulation an das ganze Labor."
                : status === "GROUP_STAGE" || status === "KNOCKOUT_STAGE" || status === "COMPLETED"
                  ? "Aktuell kein Spiel geplant. Daumen drücken für die anderen!"
                  : "Der Spielplan folgt nach der Auslosung."}
            </p>
          </div>
        </div>
      </Section>
    );
  }
  const opponentId = match.homeTeamId === me.teamId ? match.awayTeamId : match.homeTeamId;
  const opponentSource = match.homeTeamId === me.teamId ? match.awaySource : match.homeSource;
  const opponent = teamOf(idx, opponentId);
  const ahead = matchesAhead(data, match.id);
  let when: { icon: React.ReactNode; text: string; tone: string };
  if (match.status === "IN_PROGRESS") {
    when = { icon: <Play aria-hidden="true" />, text: "Läuft jetzt! Viel Erfolg!", tone: "text-live" };
  } else if (match.status === "ASSIGNED") {
    when = {
      icon: <MapPin aria-hidden="true" />,
      text: `Jetzt an Tisch ${match.tableNumber ?? "?"} kommen!`,
      tone: "text-status-assigned",
    };
  } else if (match.status === "AWAITING_CONFIRMATION") {
    when = { icon: <Hourglass aria-hidden="true" />, text: "Resultat wird bestätigt", tone: "text-warning" };
  } else if (ahead != null) {
    when = { icon: <CalendarClock aria-hidden="true" />, text: aheadText(ahead), tone: "text-primary" };
  } else {
    when = {
      icon: <CalendarClock aria-hidden="true" />,
      text: "Termin folgt",
      tone: "text-muted-foreground",
    };
  }
  const urgent = match.status === "ASSIGNED" || match.status === "IN_PROGRESS";
  return (
    <Section title="Mein nächstes Spiel">
      <Link
        href={`/matches/${match.id}`}
        // No aria-label: the name comes from the visible content (axe label-content-name-mismatch).
        className="group block rounded-2xl focus-visible:outline-offset-4"
      >
        <article
          className={cn(
            "bg-card group-hover:border-primary/60 flex flex-col gap-4 rounded-2xl border-2 p-5 transition-colors",
            urgent ? "border-status-live/70" : "border-primary/40",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-display text-muted-foreground tracking-widest">{match.label}</span>
            <div className="flex items-center gap-2">
              {match.tableNumber != null && <TableBadge number={match.tableNumber} />}
              <StatusPill status={match.status} />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              {myTeam && <TeamAvatar name={myTeam.name} logoUrl={myTeam.logoUrl} side="home" size="lg" />}
              <span className="font-display line-clamp-2 text-xl leading-tight break-words">
                {myTeam?.name ?? "Ihr"}
              </span>
            </div>
            <Swords className="text-muted-foreground size-7" aria-label="gegen" />
            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              {opponent ? (
                <TeamAvatar name={opponent.name} logoUrl={opponent.logoUrl} side="away" size="lg" />
              ) : (
                <span
                  className="border-border size-16 rounded-2xl border-2 border-dashed"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "line-clamp-2 leading-tight break-words",
                  opponent ? "font-display text-xl" : "text-muted-foreground italic",
                )}
              >
                {opponent?.name ??
                  (opponentSource ? `Gegner: ${sourceLabel(opponentSource)}` : "Gegner noch offen")}
              </span>
            </div>
          </div>
          <p
            className={cn(
              "bg-muted/60 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0",
              when.tone,
            )}
            aria-live="polite"
          >
            {when.icon}
            {when.text}
          </p>
        </article>
      </Link>
    </Section>
  );
}

function GuestCta() {
  return (
    <section
      aria-label="Mitmachen"
      className="border-primary/40 bg-primary/5 flex flex-col gap-4 rounded-2xl border-2 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-display text-2xl leading-tight">Mitspielen oder mitfiebern?</p>
        <p className="text-muted-foreground">Mit einem Konto siehst du dein nächstes Spiel und alles live.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/register" className={buttonVariants({ size: "lg" })}>
          <UserPlus aria-hidden="true" /> Registrieren
        </Link>
        <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
          <LogIn aria-hidden="true" /> Anmelden
        </Link>
      </div>
    </section>
  );
}

function PasswordCta() {
  return (
    <section
      aria-label="Konto"
      className="border-warning/50 bg-warning/5 flex flex-col gap-4 rounded-2xl border-2 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-display text-2xl leading-tight">Noch ein Schritt: Passwort ändern</p>
        <p className="text-muted-foreground">
          Du bist angemeldet, nutzt aber noch das Startpasswort. Danach siehst du dein nächstes Spiel und
          alles live.
        </p>
      </div>
      <Link href="/profile?mustChange=1" className={buttonVariants({ size: "lg" })}>
        <KeyRound aria-hidden="true" /> Passwort ändern
      </Link>
    </section>
  );
}

function NowLive({
  data,
  idx,
  clockOffsetMs,
}: {
  data: AnySnapshot;
  idx: SnapshotIndex;
  clockOffsetMs: number;
}) {
  const tables = [...data.tables].sort((a, b) => a.number - b.number);
  if (tables.length === 0) return null;
  // Free tables get a hint for the next suggested matches, in order.
  const queue = data.upNext
    .map((id) => idx.matchById.get(id))
    .filter((m): m is LiveMatch => !!m && m.status === "READY");
  let q = 0;
  return (
    <Section title="Jetzt live">
      <div className="grid gap-3 md:grid-cols-2">
        {tables.map((t) => {
          const m = tableMatch(idx, t);
          const next = !m && t.state !== "DISABLED" ? (queue[q++] ?? null) : null;
          return (
            <LiveTableCard
              key={t.id}
              table={t}
              match={m}
              idx={idx}
              clockOffsetMs={clockOffsetMs}
              nextMatch={next}
            />
          );
        })}
      </div>
    </Section>
  );
}

function UpNext({ data, idx }: { data: AnySnapshot; idx: SnapshotIndex }) {
  const items = data.upNext.map((id) => idx.matchById.get(id)).filter((m): m is LiveMatch => !!m);
  if (items.length === 0) return null;
  return (
    <Section title="Als Nächstes">
      <ol className="grid gap-3 md:grid-cols-2">
        {items.map((m, i) => (
          <li key={m.id} className="relative">
            <span className="sr-only">{i + 1}. </span>
            <MatchCard match={toCardData(m, idx)} href={`/matches/${m.id}`} />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function StandingsPreview({ data, idx }: { data: AnySnapshot; idx: SnapshotIndex }) {
  const knockout = data.tournament.status === "KNOCKOUT_STAGE" || data.tournament.status === "COMPLETED";
  const myTeamId = data.me?.teamId ?? null;
  const more = (href: string, label: string) => (
    <Link href={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
      {label} <ArrowRight aria-hidden="true" />
    </Link>
  );
  if (knockout && data.matches.some((m) => m.stage === "KNOCKOUT")) {
    return (
      <Section title="K.-o.-Tableau" action={more("/tournament?tab=ko", "Ganzes Tableau")}>
        <div className="bg-card/50 rounded-2xl border p-2 sm:p-3">
          <Bracket
            matches={data.matches}
            teamById={idx.teamById}
            championTeamId={data.tournament.championTeamId}
            scale={0.8}
          />
        </div>
      </Section>
    );
  }
  if (data.groups.length === 0) return null;
  return (
    <Section title="Gruppen" action={more("/tournament", "Alle Tabellen")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.groups.map((g) => (
          // Stretched link: the whole card is clickable, but the standings stay outside the
          // link in the accessibility tree (a table inside a link loses its semantics).
          <article
            key={g.name}
            className="bg-card has-[a:hover]:border-primary/60 relative flex flex-col gap-2 rounded-2xl border p-3 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xl leading-none">
                <Link
                  href="/tournament?tab=gruppen"
                  className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-[var(--ring)]"
                >
                  Gruppe <span className="text-primary">{g.name}</span>
                  <span className="sr-only">: ganze Tabelle öffnen</span>
                </Link>
              </h3>
              {g.unresolvedTie && <GroupStatusLine group={g} />}
            </div>
            <GroupStandings group={g} teamById={idx.teamById} variant="mini" myTeamId={myTeamId} />
          </article>
        ))}
      </div>
    </Section>
  );
}

function PreTournament({ data }: { data: AnySnapshot }) {
  if (data.matches.length > 0) return null;
  return (
    <EmptyState icon={<Sparkles />} title="Das Experiment beginnt bald">
      <p>
        Sobald 12 Teams bereit sind, werden die Gruppen ausgelost. Bis dahin: Regeln studieren und Wurfarm
        aufwärmen.
      </p>
      <Link href="/rules" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
        <BookOpen aria-hidden="true" /> Zu den Regeln
      </Link>
    </EmptyState>
  );
}

function View({
  data,
  connection,
  clockOffsetMs,
  viewer,
}: {
  data: AnySnapshot;
  connection: Connection | null;
  clockOffsetMs: number;
  viewer: Viewer;
}) {
  const idx = indexSnapshot(data);
  const t = data.tournament;
  const champion = t.status === "COMPLETED" ? teamOf(idx, t.championTeamId) : null;
  const running = t.status === "GROUP_STAGE" || t.status === "KNOCKOUT_STAGE";
  return (
    <>
      <Hero data={data} connection={connection} />
      {t.isPaused && <PauseBanner />}
      {champion && <ChampionBanner team={champion} />}
      {!connection && <StaticNote mustChangePassword={viewer === "mustChangePassword"} />}
      {viewer === "member" ? (
        <MyNextMatch data={data} idx={idx} />
      ) : viewer === "mustChangePassword" ? (
        <PasswordCta />
      ) : (
        <GuestCta />
      )}
      {running && <NowLive data={data} idx={idx} clockOffsetMs={clockOffsetMs} />}
      {running && <UpNext data={data} idx={idx} />}
      <StandingsPreview data={data} idx={idx} />
      <PreTournament data={data} />
      {t.status === "COMPLETED" && (
        <Link href="/tournament?tab=spielplan" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <GitFork aria-hidden="true" /> Alle Resultate ansehen
        </Link>
      )}
    </>
  );
}

export function Dashboard({
  mode,
  initial,
  viewer,
}: {
  mode: LiveMode;
  initial: AnySnapshot;
  viewer: Viewer;
}) {
  return (
    <LiveSource mode={mode} initial={initial}>
      {({ data, connection, clockOffsetMs }) => (
        <View data={data} connection={connection} clockOffsetMs={clockOffsetMs} viewer={viewer} />
      )}
    </LiveSource>
  );
}
