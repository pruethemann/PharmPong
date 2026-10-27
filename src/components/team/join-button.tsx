"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinTeamAction } from "@/server/actions/teams";

export function JoinButton({ code }: { code: string }) {
  const t = useTranslations("team.join");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function join() {
    start(async () => {
      const res = await joinTeamAction({ code });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      toast.success(t("welcome"));
      router.push("/team");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="xl" variant="accent" onClick={join} disabled={pending} className="w-full">
        <UserPlus aria-hidden="true" />
        {pending ? t("joining") : t("submit")}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-center text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
