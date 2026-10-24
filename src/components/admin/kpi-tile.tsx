import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact KPI tile: label, big tabular value, optional sub line. */
export function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warning" | "destructive" | "success";
}) {
  return (
    <div
      className={cn(
        "bg-card flex min-w-0 flex-col gap-1.5 rounded-2xl border p-4",
        tone === "warning" && "border-warning/60",
        tone === "destructive" && "border-destructive/70",
        tone === "success" && "border-success/50",
      )}
    >
      <p className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
            tone === "success" && "text-success",
            tone === "default" && "text-primary",
          )}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </p>
      <div className="font-display tabular truncate text-4xl leading-none">{value}</div>
      {sub && <p className="text-muted-foreground truncate text-sm">{sub}</p>}
    </div>
  );
}
