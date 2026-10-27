import { CircleCheck, Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Team completeness, always icon + text. */
export function TeamStatusBadge({ complete, className }: { complete: boolean; className?: string }) {
  const t = useTranslations("team");
  return complete ? (
    <span
      className={cn(
        "border-success/60 bg-success/10 text-success inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
        className,
      )}
    >
      <CircleCheck className="size-4" aria-hidden="true" />
      {t("complete")}
    </span>
  ) : (
    <span
      className={cn(
        "border-warning/60 bg-warning/10 text-warning inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
        className,
      )}
    >
      <Hourglass className="size-4" aria-hidden="true" />
      {t("waitingForPartner")}
    </span>
  );
}
