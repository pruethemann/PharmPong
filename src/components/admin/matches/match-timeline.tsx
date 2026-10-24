"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { getMatchEventsAction } from "@/app/(app)/admin/_lib/read-actions";
import { formatZurich, matchEventLabel } from "@/lib/admin-labels";
import { endTypeLabel, type EndTypeKey } from "@/lib/i18n/de";
import type { TeamIndex } from "@/components/admin/live-bits";
import type { MatchEventRow } from "@/server/services/admin-read";
import { cn } from "@/lib/utils";

type Payload = Record<string, unknown>;
const obj = (v: unknown): Payload => (v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);

function resultText(r: Payload, teams: TeamIndex): string | null {
  const w = str(r.winnerTeamId);
  if (!w || typeof r.homeCupsRemaining !== "number") return null;
  const end = str(r.endType) as EndTypeKey | null;
  return `Sieger ${teams.get(w)?.name ?? "?"} · ${r.homeCupsRemaining}:${r.awayCupsRemaining}${end ? ` · ${endTypeLabel[end] ?? end}` : ""}`;
}

/** Short German summary of a match event payload. */
function describe(e: MatchEventRow, teams: TeamIndex): string | null {
  const p = obj(e.payload);
  const parts: string[] = [];
  if (typeof p.tableNumber === "number") parts.push(`Tisch ${p.tableNumber}`);
  if (p.override === true) parts.push("Admin-Override");
  if (str(p.text)) parts.push(`«${p.text}»`);
  if (str(p.note)) parts.push(`Notiz: ${p.note}`);
  const result = resultText(p, teams);
  if (result) parts.push(result);
  if (e.type === "CORRECTED") {
    const b = resultText(obj(p.before), teams);
    const a = resultText(obj(p.after), teams);
    if (b && a) parts.push(`${b} → ${a}`);
  }
  if (e.type === "FORFEITED" && str(p.winnerTeamId)) {
    parts.push(`Sieger ${teams.get(String(p.winnerTeamId))?.name ?? "?"}`);
  }
  if (e.type === "ADVANCED" && str(p.teamId)) {
    parts.push(`${teams.get(String(p.teamId))?.name ?? "?"} → ${p.toCode ?? "?"}`);
  }
  if (str(p.reason)) parts.push(`Grund: ${p.reason}`);
  return parts.length ? parts.join(" · ") : null;
}

const TONE: Record<string, string> = {
  ISSUE_REPORTED: "bg-destructive",
  ISSUE_RESOLVED: "bg-success",
  CONFIRMED: "bg-success",
  CORRECTED: "bg-warning",
  VOIDED: "bg-destructive",
  ABORTED: "bg-destructive",
  FORFEITED: "bg-status-forfeited",
  STARTED: "bg-live",
};

export function MatchTimeline({
  matchId,
  revision,
  teams,
}: {
  matchId: string;
  revision: number;
  teams: TeamIndex;
}) {
  const [rows, setRows] = useState<MatchEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMatchEventsAction({ matchId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows(res.data);
          setError(null);
        } else setError(res.message);
      })
      .catch(() => !cancelled && setError("Verlauf konnte nicht geladen werden."));
    return () => {
      cancelled = true;
    };
  }, [matchId, revision]);

  return (
    <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
      <h3 id="timeline-title" className="flex items-center gap-2 text-xl leading-none">
        <History className="text-primary size-5" aria-hidden="true" /> Verlauf
      </h3>
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : rows === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lade Verlauf …
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Noch keine Ereignisse.</p>
      ) : (
        <ol className="border-border ml-1.5 flex flex-col gap-3 border-l-2 pl-4">
          {[...rows].reverse().map((e) => {
            const text = describe(e, teams);
            return (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    "border-card absolute top-1.5 -left-[23px] size-3 rounded-full border-2",
                    TONE[e.type] ?? "bg-primary",
                  )}
                  aria-hidden="true"
                />
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold">{matchEventLabel(e.type)}</span>
                  <span className="text-muted-foreground tabular">{formatZurich(e.createdAt, "time")}</span>
                  <span className="text-muted-foreground">· {e.actorName ?? "System"}</span>
                </p>
                {text && <p className="text-muted-foreground text-sm break-words">{text}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
