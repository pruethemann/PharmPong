"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setReadyAction } from "@/server/actions/teams";

export function ReadyToggle({ ready, disabled }: { ready: boolean; disabled?: boolean }) {
  const t = useTranslations("team.ready");
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      const res = await setReadyAction({ ready: !ready });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(ready ? t("checkInUndone") : t("checkedIn"));
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="lg"
      variant={ready ? "success" : "outline"}
      aria-pressed={ready}
      onClick={toggle}
      disabled={pending || disabled}
      className="w-full"
    >
      {ready ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
      {ready ? t("me") : t("we")}
    </Button>
  );
}
