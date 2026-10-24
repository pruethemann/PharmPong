import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/components/auth/safe-next";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && safeNext(raw, "") ? raw : undefined;
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/profile?mustChange=1" : safeNext(next, "/"));

  return (
    <AuthCard
      kicker="Willkommen zurück"
      title="Anmelden"
      subtitle="Kurz einloggen, dann geht's zurück an den Labortisch."
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
