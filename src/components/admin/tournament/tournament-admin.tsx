"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Pause } from "lucide-react";
import { EmptyState, Section } from "@/components/pp/section";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { useOnline } from "@/components/admin/use-online";
import type { LifecycleInput } from "@/lib/admin-lifecycle";
import type { LiveGroup, LiveTable, LiveTeam } from "@/lib/live-types";
import type { TiebreakRow } from "@/server/services/admin-read";
import { LifecycleStepper, NextActionCard } from "./lifecycle";
import { SettingsForm } from "./settings-form";
import { DangerZone, TablesAdmin } from "./tables-and-danger";
import { ShootoutForm, TiebreakList, type TieView } from "./tiebreaks";

export type TournamentAdminProps = {
  lifecycle: LifecycleInput;
  settings: {
    name: string;
    matchDurationSec: number;
    bombRuleEnabled: boolean;
    publicDisplayEnabled: boolean;
  };
  /** Matches IN_PROGRESS or AWAITING_CONFIRMATION (blocks changing the match duration). */
  runningMatches: number;
  groups: LiveGroup[];
  teams: LiveTeam[];
  tables: LiveTable[];
  ties: TieView[];
  tiebreaks: TiebreakRow[];
};

export function TournamentAdmin(p: TournamentAdminProps) {
  const router = useRouter();
  const online = useOnline();
  const refresh = useCallback(() => router.refresh(), [router]);
  const runner = useAdminAction(refresh);
  const status = p.lifecycle.status;
  const teamById = new Map(p.teams.map((t) => [t.id, t]));
  const finished = status === "COMPLETED" || status === "CANCELLED";

  return (
    <div className="flex flex-col gap-10">
      {!online && (
        <p
          role="status"
          className="bg-destructive text-destructive-foreground flex items-center gap-2 rounded-xl px-4 py-3 font-semibold"
        >
          <CloudOff className="size-5" aria-hidden="true" /> Offline: Aktionen sind gesperrt.
        </p>
      )}
      {p.lifecycle.isPaused && (
        <p
          role="status"
          className="border-warning/60 bg-warning/10 text-warning flex items-center gap-2 rounded-xl border px-4 py-3 font-semibold"
        >
          <Pause className="size-5" aria-hidden="true" /> Das Turnier ist pausiert (Fortsetzen in der
          Übersicht).
        </p>
      )}
      <div className="flex flex-col gap-4">
        <LifecycleStepper status={status} />
        <NextActionCard input={p.lifecycle} runner={runner} online={online} />
      </div>

      {p.ties.length > 0 && (
        <Section title="Offene Gleichstände">
          <div className="grid gap-4 lg:grid-cols-2">
            {p.ties.map((t) => (
              <ShootoutForm
                key={`${t.group}-${t.basisHash}`}
                tie={t}
                runner={runner}
                online={online}
                canRecord={status === "GROUP_STAGE"}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Auslosung">
        {p.groups.length === 0 || !p.lifecycle.drawExists ? (
          <EmptyState title="Noch nicht ausgelost">
            Die Gruppen werden nach dem Sperren der Anmeldung ausgelost.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {p.groups.map((g) => (
              <article key={g.name} className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
                <h3 className="font-display text-primary text-2xl leading-none">Gruppe {g.name}</h3>
                <ul className="flex flex-col gap-2">
                  {g.rows.map((r) => {
                    const t = teamById.get(r.teamId);
                    return (
                      <li key={r.teamId} className="flex min-w-0 items-center gap-2.5">
                        <TeamAvatar name={t?.name ?? "?"} logoUrl={t?.logoUrl} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-semibold">{t?.name ?? "?"}</span>
                        {status !== "REGISTRATION_LOCKED" && (
                          <span className="text-muted-foreground tabular text-sm">{r.points} P</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {g.unresolvedTie && (
                  <p className="text-destructive text-sm font-semibold">Gleichstand offen</p>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ranking-Shootouts">
        <TiebreakList rows={p.tiebreaks} runner={runner} online={online} canVoid={status === "GROUP_STAGE"} />
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Einstellungen">
          <div className="bg-card rounded-2xl border p-5">
            <SettingsForm
              initial={p.settings}
              runner={runner}
              online={online}
              locked={finished}
              runningMatches={p.runningMatches}
            />
          </div>
        </Section>
        <Section title="Tische" className="scroll-mt-24">
          <div id="tische" className="scroll-mt-24">
            <TablesAdmin tables={p.tables} runner={runner} online={online} />
          </div>
        </Section>
      </div>

      <DangerZone status={status} drawExists={p.lifecycle.drawExists} runner={runner} online={online} />
    </div>
  );
}
