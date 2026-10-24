import {
  CircleDashed,
  CircleCheck,
  CircleDot,
  Clock,
  Flag,
  Hourglass,
  MapPin,
  Ban,
  Play,
  type LucideIcon,
} from "lucide-react";
import { matchStatusLabel, type MatchStatusKey } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";

const config: Record<MatchStatusKey, { icon: LucideIcon; className: string }> = {
  PENDING: { icon: CircleDashed, className: "border-status-pending/60 text-muted-foreground" },
  READY: { icon: Clock, className: "border-status-ready/60 bg-status-ready/10 text-status-ready" },
  ASSIGNED: {
    icon: MapPin,
    className: "border-status-assigned/60 bg-status-assigned/10 text-status-assigned",
  },
  IN_PROGRESS: { icon: Play, className: "border-status-live/70 bg-status-live/15 text-status-live" },
  AWAITING_CONFIRMATION: {
    icon: Hourglass,
    className: "border-status-awaiting/70 bg-status-awaiting/15 text-status-awaiting",
  },
  COMPLETED: {
    icon: CircleCheck,
    className: "border-status-completed/60 bg-status-completed/10 text-status-completed",
  },
  CANCELLED: { icon: Ban, className: "border-status-cancelled/60 text-muted-foreground line-through" },
  FORFEITED: {
    icon: Flag,
    className: "border-status-forfeited/60 bg-status-forfeited/10 text-status-forfeited",
  },
};

/** Status is always icon + text + colour, never colour alone. */
export function StatusPill({
  status,
  className,
  size = "md",
}: {
  status: MatchStatusKey;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const { icon: Icon, className: tone } = config[status];
  const live = status === "IN_PROGRESS";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-4 py-1.5 text-lg",
        tone,
        className,
      )}
    >
      {live ? (
        <CircleDot className="animate-live-dot size-[1em]" aria-hidden="true" />
      ) : (
        <Icon className="size-[1em]" aria-hidden="true" />
      )}
      {matchStatusLabel[status]}
    </span>
  );
}
