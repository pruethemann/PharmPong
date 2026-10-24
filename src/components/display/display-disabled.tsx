"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MonitorOff } from "lucide-react";
import { LogoMark } from "@/components/pp/logo";

/** Dignified "off" screen; re-checks every 30 s so the projector turns on by itself. */
export function DisplayDisabled({ reason }: { reason: "disabled" | "none" }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);
  return (
    <div
      className="bg-background flex h-dvh w-full flex-col items-center justify-center gap-[2em] p-[2em] text-center"
      style={{ fontSize: "min(1vw, 1.7778vh)" }}
    >
      <LogoMark title="" className="size-[10em] opacity-90" />
      <p className="font-display text-[5em] leading-none">
        Pharma<span className="text-primary">Pong</span>
      </p>
      <div className="text-muted-foreground flex items-center gap-[0.6em] text-[2.4em]">
        <MonitorOff className="size-[1.1em]" aria-hidden="true" />
        <h1 className="font-sans text-[1em] font-semibold tracking-normal normal-case">
          {reason === "none" ? "Noch kein Turnier geplant" : "Anzeige ist deaktiviert"}
        </h1>
      </div>
      <p className="text-muted-foreground max-w-[50em] text-[1.6em]">
        Die Turnierleitung schaltet die öffentliche Anzeige frei, sobald es losgeht. Diese Seite aktualisiert
        sich automatisch.
      </p>
    </div>
  );
}
