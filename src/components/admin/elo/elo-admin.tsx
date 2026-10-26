"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  Download,
  Hourglass,
  MonitorPlay,
  Play,
  QrCode,
  ShieldAlert,
  Swords,
  UserRound,
  Users,
} from "lucide-react";
import { setPublicDisplayAction } from "@/server/actions/elo-admin";
import type { ModeBlocker } from "@/server/services/game-mode";
import type { EloAdminMatchRow, EloRunRow, EloSessionAdmin } from "@/server/services/elo-read";
import { KpiTile } from "@/components/admin/kpi-tile";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { EloLiveProvider, useEloLive, type EloSnapshot } from "@/components/elo/elo-live";
import { EloMatchRow } from "@/components/elo/elo-match-row";
import { Leaderboard, ProvisionalLegend } from "@/components/elo/leaderboard";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { Section } from "@/components/pp/section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MatchesAdmin } from "./matches-admin";
import { ModeCard } from "./mode-card";
import { RatingsAdmin } from "./ratings-admin";
import { SessionPanel } from "./session-panel";
import { SettingsPanel } from "./settings-panel";

const EXPORTS = [
  { format: "json", label: "Komplett-Export (JSON)" },
  { format: "rankings.csv", label: "Rangliste (CSV)" },
  { format: "matches.csv", label: "Matches (CSV)" },
];

type Props = {
  initial: EloSnapshot;
  session: EloSessionAdmin | null;
  matches: EloAdminMatchRow[];
  runs: EloRunRow[];
  mode: { gameMode: "COMPETITIVE" | "ELO"; blockers: ModeBlocker[] };
};

function View({ session, matches, runs, mode }: Omit<Props, "initial">) {
  const { data, connection, refresh } = useEloLive();
  const router = useRouter();
  // Server-rendered parts (match list, runs, config version) follow the live revision.
  const seen = useRef(data.revision);
  useEffect(() => {
    if (seen.current === data.revision) return;
    seen.current = data.revision;
    router.refresh();
  }, [data.revision, router]);
  const refreshAll = useCallback(() => {
    refresh();
    router.refresh();
  }, [refresh, router]);
  const runner = useAdminAction(refreshAll);
  const s = data.stats;
  const disputes = data.pendingMatches.filter((m) => m.status === "DISPUTED");
  const pending = data.pendingMatches.filter((m) => m.status === "AWAITING_CONFIRMATION");
  const running = data.liveMatches.filter((m) => m.status === "IN_PROGRESS").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-end">
        <ConnectionBadge state={connection ?? "online"} />
      </div>
      <ModeCard gameMode={mode.gameMode} blockers={mode.blockers} showManageLink={false} />
      <SessionPanel session={session} data={data} runner={runner} />

      {session && (
        <>
          <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile icon={Swords} label="Matches" value={s.completed} sub={`${s.rated} gewertet`} />
            <KpiTile
              icon={Users}
              label="Spieler:innen"
              value={s.players}
              sub={`${s.provisional} vorläufig`}
            />
            <KpiTile
              icon={CheckCheck}
              label="Titelberechtigt"
              value={s.eligible}
              sub={`ab ${session.settings.minGamesForChampion} Spielen`}
              tone={s.eligible > 0 ? "success" : "default"}
            />
            <KpiTile
              icon={Play}
              label="Laufend"
              value={running}
              sub={`${data.liveMatches.length - running} Aufstellungen`}
            />
            <KpiTile
              icon={Hourglass}
              label="Resultate offen"
              value={pending.length}
              tone={pending.length ? "warning" : "default"}
            />
            <KpiTile
              icon={ShieldAlert}
              label="Einsprüche"
              value={disputes.length}
              tone={disputes.length ? "destructive" : "default"}
            />
          </section>

          {(disputes.length > 0 || pending.length > 0) && (
            <Section title="Zu erledigen">
              <ul className="flex flex-col gap-2">
                {[...disputes, ...pending].map((m) => (
                  <li key={m.id}>
                    <EloMatchRow match={m} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Rangliste">
            {data.leaderboard.length === 0 ? (
              <p className="text-muted-foreground">Noch keine bestätigten Matches.</p>
            ) : (
              <>
                <Leaderboard
                  rows={data.leaderboard.slice(0, 10)}
                  championIds={
                    data.session?.status === "CLOSED" ? data.session.champions.map((c) => c.userId) : []
                  }
                  caption="Elo-Rangliste (Admin)"
                />
                <ProvisionalLegend minGames={session.settings.minGamesForChampion} />
                {data.leaderboard.length > 10 && (
                  <Link
                    href="/elo/rankings"
                    className="text-primary text-sm font-semibold underline-offset-4 hover:underline"
                  >
                    Alle {data.leaderboard.length} in der Rangliste ansehen
                  </Link>
                )}
              </>
            )}
          </Section>

          <MatchesAdmin matches={matches} roster={data.roster ?? []} runner={runner} />
          <RatingsAdmin session={session} data={data} runs={runs} runner={runner} />

          {session.status !== "CLOSED" && (
            <Section title="Einstellungen">
              <div className="bg-card rounded-2xl border p-4">
                <SettingsPanel key={session.configVersion} session={session} runner={runner} />
              </div>
            </Section>
          )}
        </>
      )}

      <Section title="Anzeige, QR-Codes und Export">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
            <h3 className="flex items-center gap-2 text-xl leading-none">
              <MonitorPlay className="text-primary size-5" aria-hidden="true" /> Öffentliche Anzeige
            </h3>
            <p className="text-muted-foreground text-sm">
              Beamer unter{" "}
              <Link href="/display" className="text-primary underline underline-offset-4">
                /display
              </Link>{" "}
              zeigt im Elo-Modus Tische, Rangliste und Auszeichnungen. Nie E-Mails.
            </p>
            <label className="bg-muted/40 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-2">
              <span className="font-semibold">
                {data.tournament.publicDisplayEnabled ? "Eingeschaltet" : "Ausgeschaltet"}
              </span>
              <Switch
                checked={data.tournament.publicDisplayEnabled}
                disabled={runner.pending !== null}
                onCheckedChange={(v) =>
                  void runner.run("display", () => setPublicDisplayAction({ enabled: v }), {
                    success: v ? "Öffentliche Anzeige eingeschaltet." : "Öffentliche Anzeige ausgeschaltet.",
                  })
                }
                aria-label="Öffentliche Anzeige"
              />
            </label>
          </div>
          <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
            <h3 className="flex items-center gap-2 text-xl leading-none">
              <QrCode className="text-primary size-5" aria-hidden="true" /> QR-Codes der Tische
            </h3>
            <p className="text-muted-foreground text-sm">
              Eine Seite pro Tisch zum Ausdrucken. Der Code öffnet nur die Tischseite und berechtigt zu
              nichts.
            </p>
            <Button variant="outline" render={<Link href="/print/elo-qr" />} nativeButton={false}>
              <QrCode aria-hidden="true" /> QR-Codes drucken
            </Button>
          </div>
          <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
            <h3 className="flex items-center gap-2 text-xl leading-none">
              <Download className="text-primary size-5" aria-hidden="true" /> Export
            </h3>
            <div className="flex flex-col gap-2">
              {EXPORTS.map((x) => (
                <Button
                  key={x.format}
                  variant="outline"
                  className="justify-start"
                  render={<a href={`/api/admin/elo-export?format=${x.format}`} download />}
                  nativeButton={false}
                >
                  <Download aria-hidden="true" />
                  {x.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Section>
      {session && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <UserRound className="size-4" aria-hidden="true" /> Korrekturen, Annullierungen und
          Parameteränderungen stehen mit Begründung im Audit-Log.
        </p>
      )}
    </div>
  );
}

/** /admin/elo: mode, round life cycle, KPIs, queue, ranking, matches, calculation, settings, export. */
export function EloAdmin({ initial, ...rest }: Props) {
  return (
    <EloLiveProvider mode="authed" initial={initial}>
      <View {...rest} />
    </EloLiveProvider>
  );
}
