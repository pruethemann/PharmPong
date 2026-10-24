import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = { title: "Passwort zurücksetzen", referrer: "no-referrer" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthCard
      kicker="Kontowiederherstellung"
      title="Neues Passwort"
      subtitle="Wähle ein neues Passwort. Der Link funktioniert nur einmal und ist 30 Minuten gültig."
    >
      <ResetForm token={token} />
    </AuthCard>
  );
}
