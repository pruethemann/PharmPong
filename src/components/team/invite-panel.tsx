"use client";

import { useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rotateInviteCodeAction } from "@/server/actions/teams";
import { formatInviteCode } from "./format";

const noopSubscribe = () => () => {};

export function InvitePanel({
  code,
  appUrl,
  canRotate,
}: {
  code: string;
  appUrl: string;
  canRotate: boolean;
}) {
  const t = useTranslations("team.invite");
  const router = useRouter();
  const [pending, start] = useTransition();
  // navigator.share only exists in (some) browsers; false during SSR avoids hydration mismatch.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const link = `${appUrl.replace(/\/$/, "")}/join/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "PharmaPong",
        text: t("shareText", { code: formatInviteCode(code) }),
        url: link,
      });
    } catch {
      // user cancelled
    }
  }

  function rotate() {
    start(async () => {
      const res = await rotateInviteCodeAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(t("rotated"));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="invite-title" className="bg-card flex flex-col gap-4 rounded-2xl border p-5">
      <h2 id="invite-title" className="text-2xl leading-none">
        {t("title")}
      </h2>
      <div className="bg-muted/60 flex flex-col items-center gap-1 rounded-xl p-4">
        <span className="text-muted-foreground text-sm">{t("codeLabel")}</span>
        <output
          aria-label={t("codeAria", { code: code.split("").join(" ") })}
          className="font-display tabular text-primary text-5xl tracking-[0.15em] select-all sm:text-6xl"
        >
          {formatInviteCode(code)}
        </output>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" size="lg" onClick={copy}>
          <Copy aria-hidden="true" />
          {t("copy")}
        </Button>
        {canShare && (
          <Button type="button" size="lg" variant="outline" onClick={share}>
            <Share2 aria-hidden="true" />
            {t("share")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm break-all">{link}</p>
      {canRotate && (
        <Button type="button" variant="ghost" onClick={rotate} disabled={pending} className="self-start">
          <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : undefined} />
          {pending ? t("rotating") : t("rotate")}
        </Button>
      )}
    </section>
  );
}
