"use client";

import { useState } from "react";
import { Flag, Loader2, Pause, Play, PlusCircle, RotateCcw } from "lucide-react";
import {
  closeEloSessionAction,
  openEloSessionAction,
  reopenEloSessionAction,
  setEloSessionStatusAction,
} from "@/server/actions/elo-admin";
import { ELO_CLOSE_CONFIRM_TEXT } from "@/server/domain/elo/config";
import type { EloSessionAdmin } from "@/server/services/elo-read";
import { teamLabel } from "@/lib/elo-format";
import { eloSessionStatusLabel } from "@/lib/i18n/de-elo";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, ReasonField, TypedConfirmField, reasonOk } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { EloChampionBanner } from "@/components/elo/elo-banners";
import type { EloSnapshot } from "@/components/elo/elo-live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Runner = ReturnType<typeof useAdminAction>;

function OpenRound({ runner, again }: { runner: Runner; again: boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void runner.run("open", () => openEloSessionAction(name.trim() ? { name: name.trim() } : {}), {
          success: "Elo-Runde eröffnet: alle starten mit 100 Elo.",
        });
      }}
    >
      <AdminField
        id="round-name"
        label={again ? "Name der neuen Runde" : "Name der Runde"}
        className="flex-1"
      >
        <Input
          id="round-name"
          value={name}
          maxLength={60}
          placeholder="Social Elo"
          onChange={(e) => setName(e.target.value)}
        />
      </AdminField>
      <Button type="submit" size="lg" variant="accent" disabled={runner.pending !== null}>
        <PlusCircle aria-hidden="true" /> {again ? "Neue Runde eröffnen" : "Runde eröffnen"}
      </Button>
    </form>
  );
}

/** Round status and its life cycle: open, pause/resume, close (champions), reopen. */
export function SessionPanel({
  session,
  data,
  runner,
}: {
  session: EloSessionAdmin | null;
  data: EloSnapshot;
  runner: Runner;
}) {
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const { run, pending } = runner;

  if (!session) {
    return (
      <section aria-labelledby="round-title" className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
        <h2 id="round-title" className="text-2xl leading-none">
          Elo-Runde
        </h2>
        <p className="text-muted-foreground">
          Noch keine Runde. Sie startet auch automatisch beim ersten Wechsel in den Elo-Modus.
        </p>
        <OpenRound runner={runner} again={false} />
      </section>
    );
  }

  const ref = { sessionId: session.id, expectedConfigVersion: session.configVersion };
  const leaders = data.leaderboard.filter(
    (r) =>
      r.eligible && r.rank === Math.min(...data.leaderboard.filter((x) => x.eligible).map((x) => x.rank)),
  );
  const open = data.liveMatches.length + data.pendingMatches.length;

  return (
    <section aria-labelledby="round-title" className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="round-title" className="text-2xl leading-none">
          {session.name}
        </h2>
        <span className="font-semibold">{eloSessionStatusLabel[session.status]}</span>
      </div>
      {session.status === "CLOSED" ? (
        <>
          <EloChampionBanner champions={data.session?.champions ?? []} />
          {(data.session?.champions.length ?? 0) === 0 && (
            <p className="text-muted-foreground">Beendet ohne Champion: Niemand war titelberechtigt.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setReopenOpen(true)}
              disabled={pending !== null}
            >
              <RotateCcw aria-hidden="true" /> Wieder öffnen
            </Button>
          </div>
          <OpenRound runner={runner} again />
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {session.status === "PAUSED"
              ? "Pausiert: Neue Matches starten nicht, laufende werden fertig gespielt und bestätigt."
              : "Läuft: Alle können Matches erstellen."}{" "}
            {data.stats.eligible} von {data.stats.players} Spieler:innen sind titelberechtigt (mindestens{" "}
            {session.settings.minGamesForChampion} gewertete Spiele).
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {session.status === "OPEN" ? (
              <Button
                variant="warning"
                size="lg"
                disabled={pending !== null}
                onClick={() =>
                  run("pauseRound", () => setEloSessionStatusAction({ ...ref, status: "PAUSED" }), {
                    success: "Elo-Runde pausiert.",
                  })
                }
              >
                {pending === "pauseRound" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
                Runde pausieren
              </Button>
            ) : (
              <Button
                variant="success"
                size="lg"
                disabled={pending !== null}
                onClick={() =>
                  run("resumeRound", () => setEloSessionStatusAction({ ...ref, status: "OPEN" }), {
                    success: "Elo-Runde läuft wieder.",
                  })
                }
              >
                {pending === "resumeRound" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                Runde fortsetzen
              </Button>
            )}
            <Button
              variant="destructive"
              size="lg"
              disabled={pending !== null}
              onClick={() => {
                setTyped("");
                setCloseOpen(true);
              }}
            >
              <Flag aria-hidden="true" /> Runde beenden
            </Button>
          </div>
        </>
      )}

      <AdminDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Elo-Runde beenden?"
        tone="destructive"
        description="Die Rangliste wird eingefroren und der Titel vergeben. Danach starten keine Matches mehr (wieder öffnen ist möglich)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={pending !== null || typed.trim() !== ELO_CLOSE_CONFIRM_TEXT || open > 0}
              onClick={async () => {
                const res = await run("close", () => closeEloSessionAction({ ...ref, confirmText: typed }), {
                  success: (d) =>
                    d.championUserIds.length > 0
                      ? "Runde beendet. Champion steht fest!"
                      : "Runde beendet (ohne Champion).",
                });
                if (res?.ok) setCloseOpen(false);
              }}
            >
              Runde beenden
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Titelberechtigt: <strong>{data.stats.eligible}</strong> von {data.stats.players} Spieler:innen
          </li>
          <li>
            {leaders.length > 0 ? (
              <>
                {leaders.length > 1 ? "Co-Champions" : "Champion"} nach aktuellem Stand:{" "}
                <strong>{teamLabel(leaders.map((r) => r.displayName))}</strong>
              </>
            ) : (
              "Niemand ist titelberechtigt: Die Runde endet ohne Champion."
            )}
          </li>
          {open > 0 && (
            <li className="text-destructive font-semibold">
              Noch {open} offene Matches: Zuerst abschliessen, bestätigen oder abbrechen.
            </li>
          )}
        </ul>
        <TypedConfirmField
          id="close-confirm"
          expected={ELO_CLOSE_CONFIRM_TEXT}
          value={typed}
          onChange={setTyped}
        />
      </AdminDialog>

      <AdminDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Elo-Runde wieder öffnen?"
        description="Der Titel wird bis zum nächsten Beenden zurückgezogen. Alle Wertungen bleiben."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Zurück
            </Button>
            <Button
              disabled={pending !== null || !reasonOk(reason, 5)}
              onClick={async () => {
                const res = await run("reopen", () => reopenEloSessionAction({ ...ref, reason }), {
                  success: "Elo-Runde wieder geöffnet.",
                });
                if (res?.ok) {
                  setReopenOpen(false);
                  setReason("");
                }
              }}
            >
              Wieder öffnen
            </Button>
          </>
        }
      >
        <ReasonField
          id="reopen-reason"
          value={reason}
          onChange={setReason}
          min={5}
          placeholder="z. B. Nachtrag eines Matches"
        />
      </AdminDialog>
    </section>
  );
}
