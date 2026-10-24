import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AlarmClock, CupSoda, FlaskConical, Home, Scale, Sparkles, Target, Trophy } from "lucide-react";
import { PageTitle, Section } from "@/components/pp/section";
import { db } from "@/server/db";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Regeln" };
export const dynamic = "force-dynamic";

function HouseRule() {
  return (
    <span className="border-team-away/60 bg-team-away/10 text-team-away ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-xs font-semibold">
      <Home className="size-3" aria-hidden="true" /> Hausregel
    </span>
  );
}

function RuleCard({
  icon,
  title,
  house,
  children,
}: {
  icon: ReactNode;
  title: string;
  house?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="bg-card flex flex-col gap-3 rounded-2xl border p-5">
      <h3 className="flex items-center gap-3 text-2xl leading-none">
        <span className="text-primary [&_svg]:size-7" aria-hidden="true">
          {icon}
        </span>
        <span>
          {title}
          {house && <HouseRule />}
        </span>
      </h3>
      <div className="[&_strong]:text-foreground flex flex-col gap-2 text-base leading-relaxed [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </article>
  );
}

export default async function RulesPage() {
  const id = await getCurrentTournamentId();
  const t = id
    ? await db.tournament.findUnique({
        where: { id },
        select: { matchDurationSec: true, bombRuleEnabled: true },
      })
    : null;
  const minutes = Math.round((t?.matchDurationSec ?? 900) / 60);
  const bomb = t?.bombRuleEnabled ?? false;

  return (
    <>
      <PageTitle kicker="Laborvorschriften" title="Regeln" />
      <p className="text-muted-foreground max-w-2xl text-lg">
        Inspiriert von den offiziellen RedCupShop-Regeln, angepasst für PharmaPong. Abschnitte mit{" "}
        <span className="text-team-away font-semibold">Hausregel</span> gelten speziell für unser Turnier.
      </p>

      <div className="border-success/60 bg-success/10 rounded-2xl border p-4 text-base">
        <p className="flex items-start gap-3">
          <CupSoda className="text-success mt-0.5 size-6 shrink-0" aria-hidden="true" />
          <span>
            <strong>Jedes Getränk zählt gleich.</strong> Wasser, Süssgetränk oder alkoholfreies Bier sind
            ausdrücklich willkommen. Gewertet werden nur getroffene Becher, nie wer was trinkt.
          </span>
        </p>
      </div>

      <Section title="Format">
        <div className="grid gap-4 md:grid-cols-2">
          <RuleCard icon={<Trophy />} title="Turniermodus" house>
            <ul>
              <li>12 Teams à 2 Personen, 4 Gruppen (A–D) à 3 Teams</li>
              <li>Jede:r gegen jede:n in der Gruppe: 12 Gruppenspiele</li>
              <li>Die besten 2 pro Gruppe erreichen den Viertelfinal</li>
              <li>Viertelfinal, Halbfinal, Final: total 19 Spiele auf 2 Tischen</li>
            </ul>
          </RuleCard>
          <RuleCard icon={<Target />} title="K.-o.-Tableau" house>
            <ul>
              <li>VF1: A1 – B2 · VF2: B1 – A2</li>
              <li>VF3: C1 – D2 · VF4: D1 – C2</li>
              <li>HF1: Sieger VF1 – Sieger VF3</li>
              <li>HF2: Sieger VF2 – Sieger VF4</li>
              <li>Final: Sieger HF1 – Sieger HF2</li>
            </ul>
          </RuleCard>
        </div>
      </Section>

      <Section title="Spielablauf">
        <div className="grid gap-4 md:grid-cols-2">
          <RuleCard icon={<FlaskConical />} title="Grundregeln">
            <ul>
              <li>10 Becher pro Seite im Dreieck (4-3-2-1)</li>
              <li>Die Teams werfen abwechselnd, pro Zug wirft jede Person einen Ball</li>
              <li>
                <strong>Balls Back:</strong> Treffen beide im selben Zug, gibt es beide Bälle zurück
              </li>
              <li>
                <strong>Bounce:</strong> Aufsetzer sind erlaubt und zählen einen Zusatzbecher. Das
                verteidigende Team darf Aufsetzer abwehren
              </li>
              <li>Ellbogen beim Wurf hinter der Tischkante</li>
              <li>Ein Re-Rack pro Spiel (bei 6, 4 oder 3 Bechern)</li>
            </ul>
          </RuleCard>
          <RuleCard icon={<Sparkles />} title="Sonderregeln" house>
            <ul>
              <li>
                <strong>Final-Cup-Redemption:</strong> Wird der letzte Becher getroffen, darf das Team werfen,
                bis es daneben trifft
              </li>
              <li>
                <strong>Island-Regel:</strong> aus
              </li>
              <li>
                <strong>Bomb-Regel:</strong>{" "}
                {bomb ? "aktiv (zwei Bälle im selben Becher: Becher plus ein Zusatzbecher)" : "aus"}
              </li>
            </ul>
          </RuleCard>
        </div>
      </Section>

      <Section title="Zeit & Entscheidung">
        <div className="grid gap-4 md:grid-cols-2">
          <RuleCard icon={<AlarmClock />} title={`${minutes} Minuten Spielzeit`} house>
            <ul>
              <li>
                Die Uhr startet, wenn die Schiedsrichter:in «Spiel starten» drückt. Alle Bildschirme zeigen
                dieselbe Zeit.
              </li>
              <li>
                Bei Ablauf erscheint «Zeit abgelaufen». Das laufende Zugpaar wird fertig gespielt, damit beide
                Teams gleich oft geworfen haben.
              </li>
              <li>
                Danach gewinnt das Team, das <strong>mehr gegnerische Becher getroffen</strong> hat, also mehr
                eigene Becher noch auf dem Tisch stehen hat.
              </li>
              <li>Die Uhr bestätigt nie selbst ein Resultat. Das macht immer die Schiedsrichter:in.</li>
            </ul>
          </RuleCard>
          <RuleCard icon={<Scale />} title="Shootout bei Gleichstand" house>
            <ul>
              <li>Beide Teams werfen abwechselnd je einen Ball, immer gleich viele Versuche.</li>
              <li>Trifft nach gleich vielen Versuchen nur ein Team, gewinnt es.</li>
              <li>Shootout-Treffer zählen nicht für die Becherstatistik.</li>
            </ul>
          </RuleCard>
        </div>
      </Section>

      <Section title="Gruppenwertung">
        <RuleCard icon={<Trophy />} title="Rangliste" house>
          <p>Sieg = 3 Punkte, Niederlage = 0. Unentschieden gibt es nicht.</p>
          <p>
            <strong>Becher erzielt</strong> = 10 − verbleibende Becher des Gegners ·{" "}
            <strong>Becher kassiert</strong> = 10 − eigene verbleibende Becher ·{" "}
            <strong>Becherdifferenz</strong> = erzielt − kassiert
          </p>
          <ol className="ml-5 list-decimal">
            <li>Punkte</li>
            <li>Becherdifferenz</li>
            <li>Erzielte Becher</li>
            <li>Direktbegegnung (nur wenn genau zwei Teams gleich sind)</li>
            <li>Ranking-Shootout, von der Turnierleitung erfasst</li>
          </ol>
          <p className="text-muted-foreground">
            Forfait: Das anwesende Team gewinnt mit 10:0 Bechern. Der K.-o.-Teil startet erst, wenn alle
            Gruppenspiele und allfälligen Shootouts bestätigt sind.
          </p>
        </RuleCard>
      </Section>
    </>
  );
}
