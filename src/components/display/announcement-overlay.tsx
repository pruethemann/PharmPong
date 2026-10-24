"use client";

import { Medal, Megaphone, Trophy } from "lucide-react";
import type { Announcement } from "@/lib/announcements";
import { cn } from "@/lib/utils";

const tone: Record<Announcement["kind"], { icon: typeof Megaphone; kicker: string; className: string }> = {
  NEW_MATCH: { icon: Megaphone, kicker: "Ansage", className: "border-primary text-primary" },
  SEMIFINAL: { icon: Medal, kicker: "Weiter im Turnier", className: "border-team-away text-team-away" },
  FINAL: { icon: Trophy, kicker: "Finaleinzug", className: "border-gold text-gold" },
  CHAMPION: { icon: Trophy, kicker: "Champion", className: "border-gold text-gold" },
};

/** Banner over the rotating panel for ~6 s (above the pause overlay). The live region announces it once. */
export function AnnouncementOverlay({ announcement }: { announcement: Announcement | null }) {
  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
    >
      {announcement && (
        <div
          key={announcement.id}
          className={cn(
            "bg-background/95 animate-pop-in flex max-w-[80em] items-center gap-[1.4em] rounded-[1.4em] border-[0.2em] px-[2em] py-[1.2em] shadow-[0_1em_4em_-1em_rgb(0_0_0/70%)] backdrop-blur",
            tone[announcement.kind].className,
          )}
        >
          {(() => {
            const Icon = tone[announcement.kind].icon;
            return <Icon className="size-[4.5em] shrink-0" aria-hidden="true" />;
          })()}
          <div className="flex min-w-0 flex-col gap-[0.2em]">
            <span className="font-display text-[1.5em] tracking-widest opacity-90">
              {tone[announcement.kind].kicker}
            </span>
            <span className="font-display text-foreground text-[3.8em] leading-none">
              {announcement.title}
            </span>
            {announcement.subtitle && (
              <span className="text-foreground/85 truncate text-[1.9em]">{announcement.subtitle}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
