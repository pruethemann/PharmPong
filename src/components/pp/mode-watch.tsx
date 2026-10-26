"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const CHECK_MS = 10_000;

/**
 * Keeps every page in step with the event's game mode: when the admin switches between the
 * tournament and Elo Mode, the server-rendered navigation and dashboards are refreshed.
 * Polls a tiny endpoint, pauses in hidden tabs.
 */
export function ModeWatch({ mode }: { mode: "COMPETITIVE" | "ELO" }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/mode", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { gameMode?: string };
        if (!stopped && body.gameMode && body.gameMode !== mode) router.refresh();
      } catch {
        // Offline: the live pages already show the connection state.
      }
    };
    const id = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [mode, router]);
  return null;
}
