import Link from "next/link";
import { FlaskConical, LogIn, UserPlus } from "lucide-react";
import { Logo } from "@/components/pp/logo";
import { EmptyState } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { Dashboard } from "@/components/live/dashboard";
import { loadLiveInitial, viewerOf } from "@/components/live/load-live";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const live = await loadLiveInitial();
  if (live.mode === "none") {
    return (
      <>
        <div className="flex justify-center pt-6">
          <Logo size="xl" />
        </div>
        <EmptyState icon={<FlaskConical />} title="Das Turnier wird vorbereitet">
          <p>Die Turnierleitung mischt gerade die Reagenzien. Schau bald wieder vorbei.</p>
          {!live.loggedIn && (
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              <Link href="/register" className={buttonVariants({ size: "lg" })}>
                <UserPlus aria-hidden="true" /> Registrieren
              </Link>
              <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
                <LogIn aria-hidden="true" /> Anmelden
              </Link>
            </div>
          )}
        </EmptyState>
      </>
    );
  }
  return <Dashboard mode={live.mode} initial={live.snapshot} viewer={viewerOf(live)} />;
}
