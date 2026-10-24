import Link from "next/link";
import { Info } from "lucide-react";

/**
 * Shown when a page is rendered once without live updates (guest, public sharing off).
 * `mustChangePassword`: signed in, but the initial password has to be changed first.
 */
export function StaticNote({ mustChangePassword = false }: { mustChangePassword?: boolean }) {
  return (
    <p className="border-border bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-xl border p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Stand beim Laden der Seite, ohne Live-Aktualisierung.{" "}
        {mustChangePassword ? (
          <>
            <Link
              href="/profile?mustChange=1"
              className="text-primary font-semibold underline-offset-4 hover:underline"
            >
              Ändere zuerst dein Passwort
            </Link>
            , dann verfolgst du Spiele und Tabellen live.
          </>
        ) : (
          <>
            <Link href="/login" className="text-primary font-semibold underline-offset-4 hover:underline">
              Melde dich an
            </Link>
            , um Spiele und Tabellen live zu verfolgen.
          </>
        )}
      </span>
    </p>
  );
}
