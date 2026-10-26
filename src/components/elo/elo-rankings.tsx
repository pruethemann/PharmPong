"use client";

import Link from "next/link";
import { BookOpen, Medal } from "lucide-react";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { StaticNote } from "@/components/live/static-note";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { EloChampionBanner } from "./elo-banners";
import { EloLiveProvider, useEloLive, type EloLiveMode, type EloSnapshot } from "./elo-live";
import { Leaderboard, ProvisionalLegend } from "./leaderboard";

function View({ mustChangePassword }: { mustChangePassword: boolean }) {
  const { data, connection } = useEloLive();
  const s = data.session;
  return (
    <>
      <PageTitle
        kicker={s ? `Elo-Modus · ${s.name}` : "Elo-Modus"}
        title="Rangliste"
        action={connection ? <ConnectionBadge state={connection} /> : undefined}
      />
      {!connection && <StaticNote mustChangePassword={mustChangePassword} />}
      {s?.status === "CLOSED" && <EloChampionBanner champions={s.champions} />}
      {!s || data.leaderboard.length === 0 ? (
        <EmptyState icon={<Medal />} title="Noch keine Elo-Punkte">
          <p>Sobald das erste Match bestätigt ist, erscheint hier die Rangliste.</p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            <span className="text-foreground font-semibold">{data.stats.players}</span> Spieler:innen ·{" "}
            <span className="text-foreground font-semibold">{data.stats.eligible}</span> titelberechtigt ·{" "}
            <span className="text-foreground font-semibold">{data.stats.completed}</span> Matches
          </p>
          <Leaderboard
            rows={data.leaderboard}
            meId={data.me?.userId ?? null}
            championIds={s.status === "CLOSED" ? s.champions.map((c) => c.userId) : []}
            caption="Elo-Rangliste dieser Runde"
          />
          <ProvisionalLegend minGames={s.settings.minGamesForChampion} />
          <p className="text-muted-foreground text-sm">
            Alle starten mit {s.params.initialRating} Elo. Gleiche Werte teilen sich den Rang. Gezählt werden
            nur gewertete Matches (keine Freundschaftsspiele).
          </p>
        </div>
      )}
      <Link href="/rules#elo" className={buttonVariants({ variant: "outline", size: "lg" })}>
        <BookOpen aria-hidden="true" /> So funktioniert Elo
      </Link>
    </>
  );
}

export function EloRankings({
  mode,
  initial,
  mustChangePassword,
}: {
  mode: EloLiveMode;
  initial: EloSnapshot;
  mustChangePassword: boolean;
}) {
  return (
    <EloLiveProvider mode={mode} initial={initial}>
      <View mustChangePassword={mustChangePassword} />
    </EloLiveProvider>
  );
}
