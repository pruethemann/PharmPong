import type { Metadata } from "next";
import { BuilderUnavailable, MatchBuilder } from "@/components/elo/match-builder";
import { requirePageUser } from "@/server/auth/current";
import { buildEloAuthedSnapshot } from "@/server/services/elo-snapshot";
import { getActiveGameMode } from "@/server/services/current-mode";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Match erstellen" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ table?: string | string[]; edit?: string | string[] }> };

const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EloPlayPage({ searchParams }: Props) {
  const sp = await searchParams;
  const table = Number.parseInt(single(sp.table) ?? "", 10);
  const edit = single(sp.edit)?.trim() || null;
  const returnTo = `/elo/play${edit ? `?edit=${encodeURIComponent(edit)}` : Number.isFinite(table) ? `?table=${table}` : ""}`;
  const user = await requirePageUser("PLAYER", returnTo);
  const tournamentId = await getCurrentTournamentId();
  if (!tournamentId || (!edit && (await getActiveGameMode()) !== "ELO")) {
    return (
      <BuilderUnavailable title="Elo-Modus nicht aktiv">
        <p>Gerade läuft das Turnier. Matches für die Elo-Rangliste gibt es erst wieder im Elo-Modus.</p>
      </BuilderUnavailable>
    );
  }
  const snapshot = await buildEloAuthedSnapshot(user, tournamentId);
  if (!snapshot.session) {
    return (
      <BuilderUnavailable title="Noch keine Elo-Runde">
        <p>Die Turnierleitung eröffnet die Runde. Danach kannst du sofort Matches erstellen.</p>
      </BuilderUnavailable>
    );
  }
  return (
    <MatchBuilder
      initial={snapshot}
      initialTable={Number.isFinite(table) ? table : null}
      editMatchId={edit}
    />
  );
}
