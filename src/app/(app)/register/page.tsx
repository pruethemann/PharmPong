import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CupSoda } from "lucide-react";
import { getCurrentUser } from "@/server/auth/current";
import { env } from "@/server/env";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";
import { safeNext } from "@/components/auth/safe-next";

export const metadata: Metadata = { title: "Registrieren" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && safeNext(raw, "") ? raw : undefined;
  const user = await getCurrentUser();
  if (user) redirect(safeNext(next, "/team"));
  const eventCodeRequired = env().EVENT_CODE.trim().length > 0;

  return (
    <AuthCard
      kicker="Neue Probe anmelden"
      title="Registrieren"
      subtitle="Ein Konto, ein:e Partner:in, zehn Becher. Die Versuchsanordnung ist simpel, das Resultat hoffentlich signifikant."
      footer={
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CupSoda className="text-accent mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Alkoholfreie Getränke sind ausdrücklich willkommen. Gezählt werden nur Becher, nicht Promille.
        </p>
      }
    >
      <RegisterForm next={next} eventCodeRequired={eventCodeRequired} />
    </AuthCard>
  );
}
