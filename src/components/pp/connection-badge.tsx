import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionState = "online" | "reconnecting" | "offline";

/** Visible live-sync indicator. Offline and reconnecting are loud on purpose. */
export function ConnectionBadge({ state, className }: { state: ConnectionState; className?: string }) {
  if (state === "online") {
    return (
      <span className={cn("text-muted-foreground inline-flex items-center gap-1.5 text-xs", className)}>
        <Wifi className="text-success size-3.5" aria-hidden="true" /> Live
      </span>
    );
  }
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
        state === "offline"
          ? "bg-destructive text-destructive-foreground"
          : "bg-warning text-warning-foreground",
        className,
      )}
    >
      {state === "offline" ? (
        <CloudOff className="size-4" aria-hidden="true" />
      ) : (
        <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
      )}
      {state === "offline" ? "Offline: keine Verbindung" : "Verbinde neu …"}
    </span>
  );
}
