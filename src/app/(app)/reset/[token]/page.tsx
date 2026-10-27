import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/reset-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.reset"))("metaTitle"), referrer: "no-referrer" };
}

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations("auth.reset");
  const { token } = await params;
  return (
    <AuthCard kicker={t("kicker")} title={t("title")} subtitle={t("subtitle")}>
      <ResetForm token={token} />
    </AuthCard>
  );
}
