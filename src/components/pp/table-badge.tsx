import { cn } from "@/lib/utils";

/** Large, unmistakable table identifier ("TISCH 1"). */
export function TableBadge({
  number,
  size = "md",
  className,
  muted,
}: {
  number: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-display inline-flex items-baseline gap-1.5 rounded-xl border-2 leading-none",
        muted ? "border-border text-muted-foreground" : "border-primary bg-primary/10 text-primary",
        size === "sm" && "px-2 py-1 text-sm",
        size === "md" && "px-3 py-1.5 text-lg",
        size === "lg" && "px-4 py-2 text-3xl",
        size === "xl" && "px-6 py-3 text-6xl",
        className,
      )}
    >
      <span className="text-[0.55em] tracking-widest opacity-80">Tisch</span>
      <span className="tabular">{number}</span>
    </span>
  );
}
