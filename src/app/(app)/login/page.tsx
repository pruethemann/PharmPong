import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/components/auth/safe-next";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.login"))("metaTitle") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.login");
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && safeNext(raw, "") ? raw : undefined;
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/profile?mustChange=1" : safeNext(next, "/"));

  return (
    <AuthCard kicker={t("kicker")} title={t("title")} subtitle={t("subtitle")}>
      <LoginForm next={next} />
    </AuthCard>
  );
}
