"use client";

import { useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rotateInviteCodeAction } from "@/server/actions/teams";
import { formatInviteCode } from "./format";

const noopSubscribe = () => () => {};

export function InvitePanel({
  code,
  appUrl,
  canRotate,
}: {
  code: string;
  appUrl: string;
  canRotate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // navigator.share only exists in (some) browsers; false during SSR avoids hydration mismatch.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const link = `${appUrl.replace(/\/$/, "")}/join/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link kopiert");
    } catch {
      toast.error("Kopieren nicht möglich. Bitte Code abschreiben.");
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "PharmaPong",
        text: `Komm in mein PharmaPong-Team! Code: ${formatInviteCode(code)}`,
        url: link,
      });
    } catch {
      // user cancelled
    }
  }

  function rotate() {
    start(async () => {
      const res = await rotateInviteCodeAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Neuer Code erzeugt. Der alte Code gilt nicht mehr.");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="invite-title" className="bg-card flex flex-col gap-4 rounded-2xl border p-5">
      <h2 id="invite-title" className="text-2xl leading-none">
        Partner:in einladen
      </h2>
      <div className="bg-muted/60 flex flex-col items-center gap-1 rounded-xl p-4">
        <span className="text-muted-foreground text-sm">Einladungscode</span>
        <output
          aria-label={`Einladungscode ${code.split("").join(" ")}`}
          className="font-display tabular text-primary text-5xl tracking-[0.15em] select-all sm:text-6xl"
        >
          {formatInviteCode(code)}
        </output>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" size="lg" onClick={copy}>
          <Copy aria-hidden="true" />
          Link kopieren
        </Button>
        {canShare && (
          <Button type="button" size="lg" variant="outline" onClick={share}>
            <Share2 aria-hidden="true" />
            Teilen
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm break-all">{link}</p>
      {canRotate && (
        <Button type="button" variant="ghost" onClick={rotate} disabled={pending} className="self-start">
          <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : undefined} />
          {pending ? "Wird erzeugt …" : "Neuen Code erzeugen"}
        </Button>
      )}
    </section>
  );
}
