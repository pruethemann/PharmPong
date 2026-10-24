"use client";

import { useState } from "react";
import { CalendarClock, GitFork, ListOrdered, MousePointerClick, Table2 } from "lucide-react";
import type { PublicSnapshot } from "@/lib/live-types";
import type { Connection } from "@/lib/use-live";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { MatchCard } from "@/components/pp/match-card";
import { EmptyState } from "@/components/pp/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bracket } from "@/components/bracket/bracket";
import { GroupCard } from "@/components/standings/group-card";
import { LiveSource } from "./live-source";
import {
  byPlayOrder,
  indexSnapshot,
  matchTimeInfo,
  toCardData,
  type AnySnapshot,
  type LiveMode,
  type SnapshotIndex,
  TOURNAMENT_TABS,
  type TournamentTab,
} from "./live-view";
import { PauseBanner, PhaseChip } from "./tournament-status";
import { StaticNote } from "./static-note";

function GroupsTab({
  data,
  idx,
  myTeamId,
}: {
  data: PublicSnapshot;
  idx: SnapshotIndex;
  myTeamId: string | null;
}) {
  if (data.groups.length === 0) {
    return (
      <EmptyState icon={<CalendarClock />} title="Noch keine Gruppen">
        Die Gruppen werden ausgelost, sobald die Anmeldung geschlossen ist.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.groups.map((g) => (
        <GroupCard key={g.name} group={g} matches={data.matches} idx={idx} myTeamId={myTeamId} />
      ))}
    </div>
  );
}

function KnockoutTab({ data, idx }: { data: PublicSnapshot; idx: SnapshotIndex }) {
  const hasKo = data.matches.some((m) => m.stage === "KNOCKOUT");
  if (!hasKo) {
    return (
      <EmptyState icon={<GitFork />} title="Tableau folgt">
        Das K.-o.-Tableau entsteht mit der Auslosung der Gruppen.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <MousePointerClick className="size-4 shrink-0" aria-hidden="true" />
        Tippe auf ein Spiel für Details. Auf dem Handy seitlich wischen.
      </p>
      <div className="bg-card/50 rounded-2xl border p-2 sm:p-4">
        <Bracket
          matches={data.matches}
          teamById={idx.teamById}
          championTeamId={data.tournament.championTeamId}
        />
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legende">
        <li className="flex items-center gap-1.5">
          <span className="border-border size-3 rounded border-2 border-dashed" aria-hidden="true" /> Offen
        </li>
        <li className="flex items-center gap-1.5">
          <span className="border-live size-3 rounded border-2" aria-hidden="true" /> Läuft
        </li>
        <li className="flex items-center gap-1.5">
          <span className="border-warning size-3 rounded border-2" aria-hidden="true" /> Wartet auf
          Bestätigung
        </li>
        <li className="flex items-center gap-1.5">
          <span className="border-success/60 size-3 rounded border-2" aria-hidden="true" /> Beendet
        </li>
      </ul>
    </div>
  );
}

const PHASES: { key: string; title: string; test: (m: PublicSnapshot["matches"][number]) => boolean }[] = [
  { key: "g1", title: "Gruppenphase · Runde 1", test: (m) => m.stage === "GROUP" && m.round === 1 },
  { key: "g2", title: "Gruppenphase · Runde 2", test: (m) => m.stage === "GROUP" && m.round === 2 },
  { key: "g3", title: "Gruppenphase · Runde 3", test: (m) => m.stage === "GROUP" && m.round === 3 },
  { key: "qf", title: "Viertelfinals", test: (m) => m.stage === "KNOCKOUT" && m.round === 1 },
  { key: "sf", title: "Halbfinals", test: (m) => m.stage === "KNOCKOUT" && m.round === 2 },
  { key: "f", title: "Final", test: (m) => m.stage === "KNOCKOUT" && m.round === 3 },
];

function ScheduleTab({ data, idx }: { data: PublicSnapshot; idx: SnapshotIndex }) {
  const sorted = [...data.matches].sort(byPlayOrder);
  if (sorted.length === 0) {
    return (
      <EmptyState icon={<ListOrdered />} title="Noch kein Spielplan">
        Der Spielplan mit allen 19 Spielen erscheint nach der Auslosung.
      </EmptyState>
    );
  }
  const used = new Set<string>();
  const sections = PHASES.map((p) => {
    const items = sorted.filter((m) => !used.has(m.id) && p.test(m));
    items.forEach((m) => used.add(m.id));
    return { ...p, items };
  }).filter((s) => s.items.length > 0);
  const rest = sorted.filter((m) => !used.has(m.id));
  if (rest.length > 0) sections.push({ key: "rest", title: "Weitere Spiele", test: () => true, items: rest });

  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <section key={s.key} aria-labelledby={`plan-${s.key}`} className="flex flex-col gap-2">
          <h2 id={`plan-${s.key}`} className="text-2xl leading-none">
            {s.title}
          </h2>
          <ol className="grid gap-3 md:grid-cols-2">
            {s.items.map((m) => {
              const info = matchTimeInfo(m);
              return (
                <li key={m.id} className="flex gap-3">
                  <span
                    className="font-display tabular text-muted-foreground w-8 shrink-0 pt-4 text-right text-xl leading-none"
                    aria-label={`Spiel ${m.orderIndex}`}
                  >
                    {String(m.orderIndex).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* The section heading names the round: keep the card label short. */}
                    <MatchCard
                      match={toCardData(
                        m,
                        idx,
                        m.stage === "GROUP" && m.group ? `Gruppe ${m.group}` : undefined,
                      )}
                      href={`/matches/${m.id}`}
                      className="p-3"
                    />
                    {info && <p className="text-muted-foreground pl-1 text-xs">{info}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function View({
  data,
  connection,
  initialTab,
  mustChangePassword,
}: {
  data: AnySnapshot;
  connection: Connection | null;
  initialTab: TournamentTab;
  mustChangePassword: boolean;
}) {
  const [tab, setTab] = useState<TournamentTab>(initialTab);
  const idx = indexSnapshot(data);
  const myTeamId = data.me?.teamId ?? null;

  const onTab = (value: unknown) => {
    const v = TOURNAMENT_TABS.find((t) => t === value) ?? "gruppen";
    setTab(v);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", v);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div className="flex flex-col gap-2">
          <p className="font-display text-primary text-sm tracking-widest">{data.tournament.name}</p>
          <h1 className="text-4xl leading-none sm:text-5xl">Turnier</h1>
        </div>
        <div className="flex items-center gap-3">
          {connection && <ConnectionBadge state={connection} />}
          <PhaseChip status={data.tournament.status} size="md" />
        </div>
      </div>
      {data.tournament.isPaused && <PauseBanner />}
      {!connection && <StaticNote mustChangePassword={mustChangePassword} />}

      <Tabs value={tab} onValueChange={onTab} className="gap-4">
        <TabsList className="bg-muted grid h-auto! w-full grid-cols-3 rounded-2xl p-1 sm:w-fit sm:min-w-[28rem]">
          <TabsTrigger value="gruppen" className="font-display min-h-12 rounded-xl text-lg tracking-wide">
            <Table2 aria-hidden="true" className="size-5!" /> Gruppen
          </TabsTrigger>
          <TabsTrigger value="ko" className="font-display min-h-12 rounded-xl text-lg tracking-wide">
            <GitFork aria-hidden="true" className="size-5! rotate-90" /> K.-o.
          </TabsTrigger>
          <TabsTrigger value="spielplan" className="font-display min-h-12 rounded-xl text-lg tracking-wide">
            <ListOrdered aria-hidden="true" className="size-5!" /> Spielplan
          </TabsTrigger>
        </TabsList>
        <TabsContent value="gruppen" className="text-base">
          <GroupsTab data={data} idx={idx} myTeamId={myTeamId} />
        </TabsContent>
        <TabsContent value="ko" className="min-w-0 text-base">
          <KnockoutTab data={data} idx={idx} />
        </TabsContent>
        <TabsContent value="spielplan" className="text-base">
          <ScheduleTab data={data} idx={idx} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function TournamentView({
  mode,
  initial,
  initialTab,
  mustChangePassword = false,
}: {
  mode: LiveMode;
  initial: AnySnapshot;
  initialTab: TournamentTab;
  mustChangePassword?: boolean;
}) {
  return (
    <LiveSource mode={mode} initial={initial}>
      {({ data, connection }) => (
        <View
          data={data}
          connection={connection}
          initialTab={initialTab}
          mustChangePassword={mustChangePassword}
        />
      )}
    </LiveSource>
  );
}
