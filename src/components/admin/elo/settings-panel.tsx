"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { updateEloSettingsAction } from "@/server/actions/elo-admin";
import type { EloSessionAdmin } from "@/server/services/elo-read";
import { eloResultPolicyLabel } from "@/lib/i18n/de-elo";
import { AdminField, NativeSelect, aria } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Runner = ReturnType<typeof useAdminAction>;

/** Settings that never change existing ratings: team sizes, champion minimum, reminder, result rule. */
export function SettingsPanel({ session, runner }: { session: EloSessionAdmin; runner: Runner }) {
  const s = session.settings;
  const [min, setMin] = useState(String(s.minTeamSize));
  const [max, setMax] = useState(String(s.maxTeamSize));
  const [games, setGames] = useState(String(s.minGamesForChampion));
  const [reminder, setReminder] = useState(
    s.softReminderMinutes == null ? "" : String(s.softReminderMinutes),
  );
  const [policy, setPolicy] = useState(s.resultPolicy);
  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
  const settings = {
    minTeamSize: int(min),
    maxTeamSize: int(max),
    minGamesForChampion: int(games),
    softReminderMinutes: reminder.trim() === "" ? null : int(reminder),
    resultPolicy: policy,
  };
  const valid =
    [settings.minTeamSize, settings.maxTeamSize, settings.minGamesForChampion].every(Number.isFinite) &&
    settings.minTeamSize >= 1 &&
    settings.maxTeamSize <= 4 &&
    settings.minTeamSize <= settings.maxTeamSize &&
    (settings.softReminderMinutes == null ||
      (settings.softReminderMinutes >= 1 && settings.softReminderMinutes <= 240));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void runner.run(
          "settings",
          () =>
            updateEloSettingsAction({
              sessionId: session.id,
              expectedConfigVersion: session.configVersion,
              settings,
            }),
          { success: "Einstellungen gespeichert." },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField id="s-min" label="Mindestens pro Team" hint="1–4">
          <Input
            {...aria("s-min", null, true)}
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </AdminField>
        <AdminField id="s-max" label="Höchstens pro Team" hint="1–4">
          <Input
            {...aria("s-max", null, true)}
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </AdminField>
        <AdminField id="s-games" label="Gewertete Spiele für den Titel" hint="Darunter: vorläufig">
          <Input
            {...aria("s-games", null, true)}
            inputMode="numeric"
            value={games}
            onChange={(e) => setGames(e.target.value)}
          />
        </AdminField>
        <AdminField
          id="s-rem"
          label="Erinnerung nach Minuten"
          hint="Leer = aus. Nur ein Hinweis, kein Zeitlimit."
        >
          <Input
            {...aria("s-rem", null, true)}
            inputMode="numeric"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
          />
        </AdminField>
        <AdminField id="s-policy" label="Resultat bestätigen" className="sm:col-span-2">
          <NativeSelect
            {...aria("s-policy")}
            value={policy}
            onChange={(e) => setPolicy(e.target.value as typeof policy)}
          >
            {(["DUAL_TEAM_CONFIRMATION", "REFEREE_ONLY"] as const).map((p) => (
              <option key={p} value={p}>
                {eloResultPolicyLabel[p]}
              </option>
            ))}
          </NativeSelect>
        </AdminField>
      </div>
      <p className="text-muted-foreground text-sm">
        Gilt für neue Matches. Bestehende Wertungen ändern sich dadurch nicht.
      </p>
      <Button type="submit" size="lg" disabled={!valid || runner.pending !== null} className="self-start">
        <Save aria-hidden="true" /> Einstellungen speichern
      </Button>
    </form>
  );
}
