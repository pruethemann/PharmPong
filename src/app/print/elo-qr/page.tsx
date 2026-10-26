import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/current";
import { eloTableUrl, qrSvg } from "@/server/services/elo-qr";
import { getCurrentTournamentId } from "@/server/services/tx";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "QR-Codes der Tische" };
export const dynamic = "force-dynamic";

/** One A4 page per table: QR code to /elo/table/N plus a short how-to (admin only). */
export default async function EloQrPrintPage() {
  await requirePageUser("ADMIN", "/print/elo-qr");
  const tournamentId = await getCurrentTournamentId();
  const tables = tournamentId
    ? await db.gameTable.findMany({ where: { tournamentId }, orderBy: { number: "asc" } })
    : [];
  const sheets = await Promise.all(
    tables.map(async (t) => {
      const url = eloTableUrl(t.number);
      return { id: t.id, number: t.number, url, svg: await qrSvg(url) };
    }),
  );
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin" className="font-semibold underline underline-offset-4">
          Zurück zum Admin
        </Link>
        <PrintButton />
      </div>
      {sheets.length === 0 && <p>Noch keine Tische: Sie werden mit dem Turnier angelegt.</p>}
      {sheets.map((s) => (
        <section
          key={s.id}
          aria-label={`Tisch ${s.number}`}
          className="flex min-h-[90vh] break-after-page flex-col items-center justify-center gap-6 rounded-3xl border-2 border-[#0a0f1c] p-10 text-center print:min-h-screen print:rounded-none print:border-0"
        >
          <p className="font-display text-3xl tracking-widest">PharmaPong · Elo-Modus</p>
          <h1 className="font-display text-[7rem] leading-none">Tisch {s.number}</h1>
          <div
            className="w-[min(70vw,22rem)] [&_svg]:h-auto [&_svg]:w-full"
            // SVG generated on the server by `qrcode` from our own URL (no user input).
            dangerouslySetInnerHTML={{ __html: s.svg }}
          />
          <p className="text-2xl font-semibold">Scannen, Teams wählen, losspielen.</p>
          <p className="max-w-md text-lg">
            Das andere Team bestätigt die Aufstellung auf dem eigenen Handy. Elo zählt erst, wenn beide Teams
            das Resultat bestätigt haben.
          </p>
          <p className="font-mono text-base break-all">{s.url}</p>
        </section>
      ))}
    </main>
  );
}
