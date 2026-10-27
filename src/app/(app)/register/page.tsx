import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CupSoda } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { env } from "@/server/env";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";
import { safeNext } from "@/components/auth/safe-next";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.register"))("metaTitle") };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.register");
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && safeNext(raw, "") ? raw : undefined;
  const user = await getCurrentUser();
  if (user) redirect(safeNext(next, "/team"));
  const eventCodeRequired = env().EVENT_CODE.trim().length > 0;

  return (
    <AuthCard
      kicker={t("kicker")}
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CupSoda className="text-accent mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("footer")}
        </p>
      }
    >
      <RegisterForm next={next} eventCodeRequired={eventCodeRequired} />
    </AuthCard>
  );
}
