"use client";

import Link from "next/link";
import { ArrowRight, BellRing, LogIn, Plus, Trophy, UserPlus } from "lucide-react";
import { StaticNote } from "@/components/live/static-note";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EloLiveProvider, useEloLive, type EloLiveMode, type EloSnapshot } from "./elo-live";
import { EloTableCard } from "./elo-table-card";

function View({ number, loggedIn }: { number: number; loggedIn: boolean }) {
  const { data, connection, clockOffsetMs } = useEloLive();
  const table = data.tables.find((t) => t.number === number);
  if (!table) {
    return (
      <EmptyState title={`Tisch ${number} gibt es nicht`}>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
          Zur Startseite
        </Link>
      </EmptyState>
    );
  }
  const s = data.session;
  const me = data.me;
  const elo = data.gameMode === "ELO";
  const match = data.liveMatches.find((m) => m.tableId === table.id) ?? null;
  const open = elo && s?.status === "OPEN";
  const canCreate = open && !!me && !me.liveMatchId && !match && table.state !== "DISABLED";
  const mine = match && me ? [...match.sideA, ...match.sideB].some((p) => p.userId === me.userId) : false;
  const needsMe = !!match && !!me?.todo.some((t) => t.matchId === match.id);
  const playHref = `/elo/play?table=${number}`;

  return (
    <>
      <PageTitle kicker={s ? `Elo-Modus · ${s.name}` : "Elo-Modus"} title={`Tisch ${number}`} />
      {!connection && <StaticNote mustChangePassword={loggedIn && !me} />}
      {!elo ? (
        <EmptyState icon={<Trophy />} title="Gerade läuft das Turnier">
          <p>Freie Elo-Matches gibt es erst nach dem Turnier. Bis dahin: Daumen drücken!</p>
          <Link href="/tournament" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
            Zum Turnier
          </Link>
        </EmptyState>
      ) : (
        <>
          <EloTableCard
            table={table}
            match={match}
            clockOffsetMs={clockOffsetMs}
            reminderMinutes={s?.settings.softReminderMinutes ?? null}
            canCreate={false}
          />
          {needsMe && match ? (
            <Link
              href={`/elo/matches/${match.id}`}
              className={cn(buttonVariants({ size: "xl", variant: "warning" }), "w-full")}
            >
              <BellRing aria-hidden="true" /> Aufstellung bestätigen
            </Link>
          ) : mine && match ? (
            <Link href={`/elo/matches/${match.id}`} className={cn(buttonVariants({ size: "xl" }), "w-full")}>
              Zu deinem Match <ArrowRight aria-hidden="true" />
            </Link>
          ) : canCreate ? (
            <Link href={playHref} className={cn(buttonVariants({ size: "xl", variant: "accent" }), "w-full")}>
              <Plus aria-hidden="true" /> Hier ein Match starten
            </Link>
          ) : !loggedIn && open && !match ? (
            <div className="flex flex-col gap-2">
              <Link
                href={`/login?next=${encodeURIComponent(playHref)}`}
                className={cn(buttonVariants({ size: "xl", variant: "accent" }), "w-full")}
              >
                <LogIn aria-hidden="true" /> Anmelden und spielen
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "lg", variant: "outline" }), "w-full")}
              >
                <UserPlus aria-hidden="true" /> Noch kein Konto? Registrieren
              </Link>
            </div>
          ) : !open ? (
            <p className="text-muted-foreground">
              {s?.status === "PAUSED"
                ? "Die Elo-Runde ist pausiert: Neue Matches starten, sobald die Turnierleitung fortsetzt."
                : "Die Elo-Runde ist geschlossen."}
            </p>
          ) : me?.liveMatchId && !match ? (
            <p className="text-muted-foreground">
              Du bist schon in einem anderen Match.{" "}
              <Link href={`/elo/matches/${me.liveMatchId}`} className="text-primary font-semibold underline">
                Zu deinem Match
              </Link>
            </p>
          ) : null}
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            Alle Tische und die Rangliste <ArrowRight aria-hidden="true" />
          </Link>
        </>
      )}
    </>
  );
}

/** /elo/table/N, the target of the table's QR code: public, and it grants nothing by itself. */
export function TableLanding({
  number,
  mode,
  initial,
  loggedIn,
}: {
  number: number;
  mode: EloLiveMode;
  initial: EloSnapshot;
  loggedIn: boolean;
}) {
  return (
    <EloLiveProvider mode={mode} initial={initial}>
      <View number={number} loggedIn={loggedIn} />
    </EloLiveProvider>
  );
}
