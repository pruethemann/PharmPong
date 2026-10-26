"use client";

import Link from "next/link";
import { Gavel, Hourglass, Plus, ShieldAlert, UsersRound } from "lucide-react";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { EmptyState, PageTitle, Section } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EloLiveProvider, useEloLive, type EloSnapshot } from "./elo-live";
import { EloMatchRow } from "./elo-match-row";
import { EloTableCard } from "./elo-table-card";

function Count({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Gavel;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={cn("bg-card flex min-w-0 flex-col gap-1 rounded-2xl border p-3", value > 0 && tone)}>
      <span className="flex items-center gap-2">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <span className="font-display tabular text-3xl leading-none">{value}</span>
      </span>
      <span className="text-muted-foreground text-xs leading-tight [overflow-wrap:anywhere] hyphens-auto">
        {label}
      </span>
    </div>
  );
}

function View() {
  const { data, connection, clockOffsetMs } = useEloLive();
  const s = data.session;
  const disputes = data.pendingMatches.filter((m) => m.status === "DISPUTED");
  const pending = data.pendingMatches.filter((m) => m.status === "AWAITING_CONFIRMATION");
  const drafts = data.liveMatches.filter((m) => m.status === "DRAFT");
  const byTable = new Map(data.liveMatches.map((m) => [m.tableId, m]));
  const canCreate = data.gameMode === "ELO" && s?.status === "OPEN";
  const refereeOnly = s?.settings.resultPolicy === "REFEREE_ONLY";
  return (
    <>
      <PageTitle
        kicker="Schiri-Modus · Elo"
        title="Schiri"
        action={connection ? <ConnectionBadge state={connection} /> : undefined}
      />
      <div className="grid grid-cols-3 gap-2">
        <Count
          icon={ShieldAlert}
          label="Einsprüche"
          value={disputes.length}
          tone="border-destructive/70 text-destructive"
        />
        <Count
          icon={Hourglass}
          label="Resultate offen"
          value={pending.length}
          tone="border-warning/70 text-warning"
        />
        <Count
          icon={UsersRound}
          label="Aufstellungen"
          value={drafts.length}
          tone="border-status-assigned/60 text-status-assigned"
        />
      </div>
      <p className="text-muted-foreground text-sm">
        Entscheiden kannst du nur Matches, in denen du nicht selbst mitspielst. Tippe ein Match an, um zu
        entscheiden, zu annullieren oder die Zustimmung vor Ort zu erfassen.
      </p>
      {disputes.length > 0 && (
        <Section title="Einsprüche">
          <ul className="flex flex-col gap-2">
            {disputes.map((m) => (
              <li key={m.id}>
                <EloMatchRow match={m} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Offene Resultate">
        {pending.length === 0 ? (
          <p className="text-muted-foreground">Keine offenen Resultate.</p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {refereeOnly
                ? "In dieser Runde bestätigt die Schiri jedes Resultat."
                : "Normalerweise bestätigt das andere Team. Entscheide nur, wenn es nicht weitergeht."}
            </p>
            <ul className="flex flex-col gap-2">
              {pending.map((m) => (
                <li key={m.id}>
                  <EloMatchRow match={m} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section
        title="Tische"
        action={
          canCreate ? (
            <Link href="/elo/play" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Plus aria-hidden="true" /> Match für andere
            </Link>
          ) : undefined
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {data.tables.map((t) => (
            <EloTableCard
              key={t.id}
              table={t}
              match={byTable.get(t.id) ?? null}
              clockOffsetMs={clockOffsetMs}
              reminderMinutes={s?.settings.softReminderMinutes ?? null}
              canCreate={canCreate}
            />
          ))}
        </div>
      </Section>
      {!s && (
        <EmptyState icon={<Gavel />} title="Noch keine Elo-Runde">
          <p>Die Turnierleitung eröffnet die Runde unter Admin › Elo.</p>
        </EmptyState>
      )}
    </>
  );
}

/** /elo/referee: what needs a referee right now. All decisions happen on the match page. */
export function StaffBoard({ initial }: { initial: EloSnapshot }) {
  return (
    <EloLiveProvider mode="authed" initial={initial}>
      <View />
    </EloLiveProvider>
  );
}
