"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";
import { leaveTeamAction } from "@/server/actions/teams";

export function LeaveTeam({ lastMember }: { lastMember: boolean }) {
  const t = useTranslations("team.leave");
  const router = useRouter();
  const [pending, start] = useTransition();

  function leave() {
    start(async () => {
      const res = await leaveTeamAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(res.data.dissolved ? t("dissolved") : t("left"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{lastMember ? t("lastMember") : t("otherStays")}</p>
      <HoldToConfirm onConfirm={leave} disabled={pending}>
        {pending ? t("leaving") : t("hold")}
      </HoldToConfirm>
    </div>
  );
}
