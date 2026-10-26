"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  CircleCheck,
  KeyRound,
  LogIn,
  Medal,
  Plus,
  Swords,
  UserPlus,
  Users,
} from "lucide-react";
import { teamLabel } from "@/lib/elo-format";
import { eloSessionStatusLabel } from "@/lib/i18n/de-elo";
import type { EloLeaderRow, EloLiveMatch } from "@/lib/elo-live-types";
import type { Viewer } from "@/components/live/live-view";
import { StaticNote } from "@/components/live/static-note";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { LogoMark } from "@/components/pp/logo";
import { EmptyState, Section } from "@/components/pp/section";
import { TableBadge } from "@/components/pp/table-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Achievements } from "./achievements";
import { EloChampionBanner, EloPausedBanner } from "./elo-banners";
import { EloLiveProvider, useEloLive, type EloLiveMode, type EloSnapshot } from "./elo-live";
import { EloMatchRow } from "./elo-match-row";
import { EloStatusPill, eloPillKey } from "./elo-status-pill";
import { EloTableCard } from "./elo-table-card";
import { EloTeamLine } from "./elo-team";
import { Leaderboard, ProvisionalLegend } from "./leaderboard";

const TOP = 5;

function Hero({ data }: { data: EloSnapshot }) {
  const { connection } = useEloLive();
  const s = data.session;
  return (
    <section
      aria-label="Elo-Runde"
      className="bg-card relative isolate overflow-hidden rounded-3xl border p-5 sm:p-8"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(28rem_16rem_at_100%_0%,color-mix(in_oklch,var(--accent)_16%,transparent),transparent_70%),radial-gradient(24rem_14rem_at_0%_100%,color-mix(in_oklch,var(--team-away)_14%,transparent),transparent_70%)]"
      />
      <LogoMark
        title=""
        className="text-foreground absolute -right-10 -bottom-10 -z-10 size-44 rotate-12 opacity-[0.08] sm:size-64"
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-accent text-sm tracking-widest">Elo-Modus · freies Spiel</p>
          {connection && <ConnectionBadge state={connection} />}
        </div>
        <h1 className="text-5xl leading-[0.9] break-words sm:text-7xl">{s?.name ?? "Elo-Runde"}</h1>
        {s && (
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-foreground font-semibold">{eloSessionStatusLabel[s.status]}</span>
            <span className="inline-flex items-center gap-1.5">
              <Swords className="size-4" aria-hidden="true" />
              <span className="tabular text-foreground font-semibold">{data.stats.completed}</span> Matches
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" aria-hidden="true" />
              <span className="tabular text-foreground font-semibold">{data.stats.players}</span>{" "}
              Spieler:innen
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function GuestCta() {
  return (
    <section
      aria-label="Mitspielen"
      className="border-primary/40 bg-primary/5 flex flex-col gap-4 rounded-2xl border-2 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-display text-2xl leading-tight">Lust auf ein Match?</p>
        <p className="text-muted-foreground">Mit einem Konto spielst du mit und sammelst Elo-Punkte.</p>
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
        <p className="text-muted-foreground">Danach kannst du Matches erstellen und mitspielen.</p>
      </div>
      <Link href="/profile?mustChange=1" className={buttonVariants({ size: "lg" })}>
        <KeyRound aria-hidden="true" /> Passwort ändern
      </Link>
    </section>
  );
}

function myLiveHint(m: EloLiveMatch, meId: string, needsMe: boolean): string {
  if (m.status === "IN_PROGRESS") return m.timer?.pausedAt != null ? "Pausiert" : "Läuft: viel Erfolg!";
  if (needsMe) return "Bitte die Aufstellung bestätigen";
  if (m.consentA && m.consentB) return "Beide Teams bereit: Spiel starten";
  const mySide = m.sideA.some((p) => p.userId === meId) ? "A" : "B";
  const other = mySide === "A" ? "B" : "A";
  const otherAgreed = other === "A" ? m.consentA : m.consentB;
  return `Wartet auf Team ${otherAgreed ? mySide : other}`;
}

/** My live match (draft or running) and every match that waits for me, at the very top. */
function MyMatches({ data }: { data: EloSnapshot }) {
  const me = data.me;
  if (!me) return null;
  const byId = new Map([...data.liveMatches, ...data.pendingMatches].map((m) => [m.id, m]));
  const live = me.liveMatchId ? (byId.get(me.liveMatchId) ?? null) : null;
  const todos = me.todo.filter((t) => t.matchId !== live?.id && byId.has(t.matchId));
  if (!live && todos.length === 0) return null;
  const needsMe = !!live && me.todo.some((t) => t.matchId === live.id);
  return (
    <Section title="Für dich">
      <div className="flex flex-col gap-3">
        {live && (
          <Link
            href={`/elo/matches/${live.id}`}
            className={cn(
              "bg-card hover:border-primary/60 flex flex-col gap-3 rounded-2xl border-2 p-4 transition-colors",
              needsMe
                ? "border-warning/70"
                : live.status === "IN_PROGRESS"
                  ? "border-status-live/70"
                  : "border-primary/40",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-lg">Dein Match</span>
              <div className="flex items-center gap-2">
                <TableBadge number={live.tableNumber} />
                <EloStatusPill status={eloPillKey(live)} />
              </div>
            </div>
            <EloTeamLine side="A" players={live.sideA} />
            <EloTeamLine side="B" players={live.sideB} />
            <p
              className={cn(
                "bg-muted/60 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-lg font-semibold",
                needsMe ? "text-warning" : "text-primary",
              )}
            >
              {myLiveHint(live, me.userId, needsMe)} <ArrowRight className="size-5" aria-hidden="true" />
            </p>
          </Link>
        )}
        {todos.map((t) => {
          const m = byId.get(t.matchId)!;
          return (
            <Link
              key={`${t.kind}:${t.matchId}`}
              href={`/elo/matches/${m.id}`}
              className="border-warning/70 bg-warning/5 hover:bg-warning/10 flex items-center gap-3 rounded-2xl border-2 p-4 transition-colors"
            >
              <BellRing className="text-warning size-6 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {t.kind === "CONSENT" ? "Aufstellung bestätigen" : "Resultat bestätigen"}
                </p>
                <p className="text-muted-foreground truncate text-sm">
                  Tisch {m.tableNumber}: {teamLabel(m.sideA.map((p) => p.displayName))} vs{" "}
                  {teamLabel(m.sideB.map((p) => p.displayName))}
                </p>
              </div>
              <ArrowRight className="text-warning size-5 shrink-0" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

function CreateCta() {
  return (
    <Link href="/elo/play" className={cn(buttonVariants({ size: "xl", variant: "accent" }), "w-full")}>
      <Plus aria-hidden="true" /> Match erstellen
    </Link>
  );
}

function TopRanks({ data }: { data: EloSnapshot }) {
  const meId = data.me?.userId ?? null;
  const rows: EloLeaderRow[] = data.leaderboard.slice(0, TOP);
  const mine = meId ? data.leaderboard.find((r) => r.userId === meId) : undefined;
  const extra = mine && !rows.includes(mine) ? mine : null;
  return (
    <Section
      title="Rangliste"
      action={
        <Link href="/elo/rankings" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Ganze Rangliste <ArrowRight aria-hidden="true" />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={<Medal />} title="Noch keine Elo-Punkte">
          <p>Sobald das erste Match bestätigt ist, erscheint hier die Rangliste.</p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-1">
          <Leaderboard
            rows={extra ? [...rows, extra] : rows}
            meId={meId}
            championIds={data.session?.status === "CLOSED" ? data.session.champions.map((c) => c.userId) : []}
            caption={`Top ${TOP} der Elo-Rangliste${extra ? " und dein Rang" : ""}`}
            dense
          />
          {data.session && <ProvisionalLegend minGames={data.session.settings.minGamesForChampion} />}
        </div>
      )}
    </Section>
  );
}

function View({ viewer }: { viewer: Viewer }) {
  const { data, connection, clockOffsetMs } = useEloLive();
  const router = useRouter();
  const elo = data.gameMode === "ELO";
  // The admin switched back to the tournament: reload so the server renders the right home page.
  useEffect(() => {
    if (!elo) router.refresh();
  }, [elo, router]);

  const s = data.session;
  if (!s) {
    return (
      <>
        <Hero data={data} />
        <EmptyState icon={<Swords />} title="Die Elo-Runde startet gleich">
          <p>Die Turnierleitung eröffnet die Runde. Danach kannst du sofort Matches erstellen.</p>
        </EmptyState>
      </>
    );
  }
  const me = data.me;
  const canCreate = elo && s.status === "OPEN" && !!me && !me.liveMatchId;
  const tableMatch = new Map(data.liveMatches.map((m) => [m.tableId, m]));
  const recent = data.recentMatches.slice(0, 5);
  return (
    <>
      <Hero data={data} />
      {s.status === "CLOSED" && <EloChampionBanner champions={s.champions} />}
      {s.status === "PAUSED" && <EloPausedBanner />}
      {!connection && <StaticNote mustChangePassword={viewer === "mustChangePassword"} />}
      {viewer === "guest" ? <GuestCta /> : viewer === "mustChangePassword" ? <PasswordCta /> : null}
      <MyMatches data={data} />
      {canCreate && <CreateCta />}
      <Section title="Tische">
        <div className="grid gap-3 md:grid-cols-2">
          {data.tables.map((t) => (
            <EloTableCard
              key={t.id}
              table={t}
              match={tableMatch.get(t.id) ?? null}
              clockOffsetMs={clockOffsetMs}
              reminderMinutes={s.settings.softReminderMinutes}
              canCreate={canCreate}
            />
          ))}
        </div>
      </Section>
      {data.pendingMatches.length > 0 && (
        <Section title="Resultate offen">
          <ul className="flex flex-col gap-2">
            {data.pendingMatches.map((m) => (
              <li key={m.id}>
                <EloMatchRow match={m} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <TopRanks data={data} />
      {recent.length > 0 && (
        <Section title="Letzte Resultate">
          <ul className="flex flex-col gap-2">
            {recent.map((m) => (
              <li key={m.id}>
                <EloMatchRow match={m} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Auszeichnungen">
        <Achievements achievements={data.achievements} />
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <CircleCheck className="size-4" aria-hidden="true" /> Nur zum Spass: Auszeichnungen ändern keine
          Elo-Punkte.
        </p>
      </Section>
    </>
  );
}

/** Home page in Elo Mode: arena of both tables, my tasks, ranking preview, results and awards. */
export function EloHome({
  mode,
  initial,
  viewer,
}: {
  mode: EloLiveMode;
  initial: EloSnapshot;
  viewer: Viewer;
}) {
  return (
    <EloLiveProvider mode={mode} initial={initial}>
      <View viewer={viewer} />
    </EloLiveProvider>
  );
}
