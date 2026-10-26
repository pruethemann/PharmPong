import {
  Ban,
  CheckCheck,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Hourglass,
  Pause,
  ShieldAlert,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { eloMatchStatusLabel } from "@/lib/i18n/de-elo";
import type { EloLiveMatch, EloMatchStatusKey } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";

/** Match status plus the two derived states players care about: READY (both teams agreed) and PAUSED. */
export type EloPillKey = EloMatchStatusKey | "READY" | "PAUSED";

const config: Record<EloPillKey, { icon: LucideIcon; label: string; className: string }> = {
  DRAFT: {
    icon: UsersRound,
    label: eloMatchStatusLabel.DRAFT,
    className: "border-status-assigned/60 bg-status-assigned/10 text-status-assigned",
  },
  READY: {
    icon: CheckCheck,
    label: "Bereit",
    className: "border-status-ready/60 bg-status-ready/10 text-status-ready",
  },
  IN_PROGRESS: {
    icon: CircleDot,
    label: eloMatchStatusLabel.IN_PROGRESS,
    className: "border-status-live/70 bg-status-live/15 text-status-live",
  },
  PAUSED: { icon: Pause, label: "Pausiert", className: "border-warning/70 bg-warning/15 text-warning" },
  AWAITING_CONFIRMATION: {
    icon: Hourglass,
    label: eloMatchStatusLabel.AWAITING_CONFIRMATION,
    className: "border-status-awaiting/70 bg-status-awaiting/15 text-status-awaiting",
  },
  DISPUTED: {
    icon: ShieldAlert,
    label: eloMatchStatusLabel.DISPUTED,
    className: "border-destructive/70 bg-destructive/15 text-destructive",
  },
  COMPLETED: {
    icon: CircleCheck,
    label: eloMatchStatusLabel.COMPLETED,
    className: "border-status-completed/60 bg-status-completed/10 text-status-completed",
  },
  CANCELLED: {
    icon: Ban,
    label: eloMatchStatusLabel.CANCELLED,
    className: "border-status-cancelled/60 text-muted-foreground",
  },
  VOIDED: {
    icon: CircleSlash,
    label: eloMatchStatusLabel.VOIDED,
    className: "border-status-cancelled/60 text-muted-foreground",
  },
};

export function eloPillKey(m: Pick<EloLiveMatch, "status" | "consentA" | "consentB" | "timer">): EloPillKey {
  if (m.status === "DRAFT" && m.consentA && m.consentB) return "READY";
  if (m.status === "IN_PROGRESS" && m.timer?.pausedAt != null) return "PAUSED";
  return m.status;
}

/** Always icon + text + colour, never colour alone (like StatusPill). */
export function EloStatusPill({
  status,
  size = "md",
  className,
}: {
  status: EloPillKey;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { icon: Icon, label, className: tone } = config[status];
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
      <Icon className={cn("size-[1em]", status === "IN_PROGRESS" && "animate-live-dot")} aria-hidden="true" />
      {label}
    </span>
  );
}
