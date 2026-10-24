"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { ClientTimer } from "@/components/admin/client-timer";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TeamLine, type TeamIndex } from "@/components/admin/live-bits";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { availableMatchActions, type MatchActionKind } from "@/lib/admin-matches";
import { endTypeLabel } from "@/lib/i18n/de";
import type { AuthedSnapshot, LiveMatch } from "@/lib/live-types";
import { cn } from "@/lib/utils";
import {
  AbortAction,
  AssignAction,
  ConfirmAction,
  CorrectAction,
  ForfeitAction,
  RejectAction,
  ResolveIssueAction,
  UnassignAction,
  type ActionCtx,
} from "./match-actions";
import { MatchTimeline } from "./match-timeline";
import type { RecoveryRequest } from "./recovery-wizard";

const ACTION_LABEL: Record<MatchActionKind, string> = {
  assign: "Zuweisen",
  unassign: "Freigeben",
  confirm: "Bestätigen",
  reject: "Zurückweisen",
  abort: "Spiel abbrechen",
  forfeit: "Forfait",
  correct: "Korrigieren",
  resolveIssue: "Problem lösen",
};

const DESTRUCTIVE: MatchActionKind[] = ["abort", "forfeit"];

export function MatchSheet({
  match,
  snap,
  teams,
  online,
  runner,
  clockOffsetMs,
  onClose,
  onRecovery,
}: {
  match: LiveMatch | null;
  snap: AuthedSnapshot;
  teams: TeamIndex;
  online: boolean;
  runner: ReturnType<typeof useAdminAction>;
  clockOffsetMs: number;
  onClose: () => void;
  onRecovery: (r: RecoveryRequest) => void;
}) {
  return (
    <Sheet open={!!match} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="bg-card w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        {match && (
          <SheetBody
            key={match.id}
            match={match}
            snap={snap}
            teams={teams}
            online={online}
            runner={runner}
            clockOffsetMs={clockOffsetMs}
            onRecovery={onRecovery}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  match,
  snap,
  teams,
  online,
  runner,
  clockOffsetMs,
  onRecovery,
}: {
  match: LiveMatch;
  snap: AuthedSnapshot;
  teams: TeamIndex;
  online: boolean;
  runner: ReturnType<typeof useAdminAction>;
  clockOffsetMs: number;
  onRecovery: (r: RecoveryRequest) => void;
}) {
  const ops = snap.matchOps?.[match.id];
  const actions = availableMatchActions(match.status, {
    hasBothTeams: !!match.homeTeamId && !!match.awayTeamId,
    hasOpenIssue: ops?.openIssue != null,
  });
  const [chosen, setChosen] = useState<MatchActionKind | null>(null);
  const active = chosen && actions.includes(chosen) ? chosen : (actions[0] ?? null);
  const ctx: ActionCtx = { match, snap, teams, online, runner, version: ops?.version ?? 0 };
  const res = match.result;
  const decided = match.status === "COMPLETED" || match.status === "FORFEITED";

  return (
    <div className="flex flex-col">
      <header className="bg-card sticky top-0 z-10 flex items-start gap-3 border-b p-4 pr-16">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SheetTitle className="font-display text-4xl leading-none">{match.code}</SheetTitle>
          <SheetDescription className="text-base">{match.label}</SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={match.status} />
            {match.tableNumber != null && <TableBadge number={match.tableNumber} size="sm" />}
          </div>
        </div>
        <SheetPrimitive.Close
          render={<Button variant="ghost" size="icon" className="absolute top-3 right-3" />}
          aria-label="Schliessen"
        >
          <XIcon aria-hidden="true" />
        </SheetPrimitive.Close>
      </header>

      <div className="flex flex-col gap-6 p-4">
        <section aria-label="Teams" className="bg-muted/30 flex flex-col gap-3 rounded-2xl border p-4">
          <TeamLine
            teams={teams}
            teamId={match.homeTeamId}
            source={match.homeSource}
            side="home"
            cups={decided ? res?.homeCupsRemaining : null}
            winner={decided && res?.winnerTeamId === match.homeTeamId}
          />
          <TeamLine
            teams={teams}
            teamId={match.awayTeamId}
            source={match.awaySource}
            side="away"
            cups={decided ? res?.awayCupsRemaining : null}
            winner={decided && res?.winnerTeamId === match.awayTeamId}
          />
          {res && <p className="text-muted-foreground text-sm">{endTypeLabel[res.endType]}</p>}
          {match.timer?.startedAt != null && !decided && (
            <ClientTimer timer={match.timer} clockOffsetMs={clockOffsetMs} />
          )}
          {match.nextCode && (
            <p className="text-muted-foreground text-sm">Sieger spielt weiter in {match.nextCode}.</p>
          )}
        </section>

        {actions.length > 0 && active ? (
          <section aria-labelledby="actions-title" className="flex flex-col gap-4">
            <h3 id="actions-title" className="text-xl leading-none">
              Aktionen
            </h3>
            {actions.length > 1 && (
              <div role="group" aria-label="Aktion wählen" className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button
                    key={a}
                    variant={active === a ? (DESTRUCTIVE.includes(a) ? "destructive" : "secondary") : "ghost"}
                    aria-pressed={active === a}
                    className={cn("border", active === a ? "border-current" : "border-border")}
                    onClick={() => setChosen(a)}
                  >
                    {ACTION_LABEL[a]}
                  </Button>
                ))}
              </div>
            )}
            <div className="bg-background/40 rounded-2xl border p-4">
              {active === "assign" && <AssignAction {...ctx} />}
              {active === "unassign" && <UnassignAction {...ctx} />}
              {active === "confirm" && <ConfirmAction {...ctx} />}
              {active === "reject" && <RejectAction {...ctx} />}
              {active === "abort" && <AbortAction {...ctx} />}
              {active === "forfeit" && <ForfeitAction {...ctx} />}
              {active === "resolveIssue" && <ResolveIssueAction {...ctx} />}
              {active === "correct" && <CorrectAction {...ctx} onRecovery={onRecovery} />}
            </div>
          </section>
        ) : (
          <p className="text-muted-foreground">
            {match.status === "PENDING"
              ? "Noch nicht spielbereit: Teams stehen noch nicht fest oder die Phase hat nicht begonnen."
              : match.status === "IN_PROGRESS"
                ? "Läuft. Die Schiedsrichter:in erfasst das Resultat."
                : "Für dieses Spiel gibt es keine Aktionen."}
          </p>
        )}

        <MatchTimeline matchId={match.id} revision={snap.revision} teams={teams} />
      </div>
    </div>
  );
}
