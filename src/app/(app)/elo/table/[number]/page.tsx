import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Swords } from "lucide-react";
import { loadEloInitial } from "@/components/elo/load-elo";
import { TableLanding } from "@/components/elo/table-landing";
import { EmptyState, PageTitle } from "@/components/pp/section";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ number: string }> };

const parse = (raw: string) => (/^\d{1,3}$/.test(raw) ? Number(raw) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = parse((await params).number);
  return { title: n ? `Tisch ${n}` : "Tisch" };
}

/** Landing page of a table's QR code. Public; a QR code never grants anything by itself. */
export default async function EloTablePage({ params }: Props) {
  const n = parse((await params).number);
  if (n == null) notFound();
  const elo = await loadEloInitial();
  if (elo.mode === "none") {
    return (
      <>
        <PageTitle kicker="Elo-Modus" title={`Tisch ${n}`} />
        <EmptyState icon={<Swords />} title="Noch kein Turnier">
          <p>Sobald die Turnierleitung das Turnier eröffnet, geht es hier los.</p>
        </EmptyState>
      </>
    );
  }
  return <TableLanding number={n} mode={elo.mode} initial={elo.snapshot} loggedIn={elo.loggedIn} />;
}
