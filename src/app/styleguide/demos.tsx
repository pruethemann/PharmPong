"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BigTimer } from "@/components/pp/big-timer";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";

export function HoldDemo() {
  return (
    <div className="max-w-sm">
      <HoldToConfirm onConfirm={() => toast.success("Bestätigt!")}>Gedrückt halten: Forfait</HoldToConfirm>
    </div>
  );
}

export function TimerDemo() {
  const [startedAt] = useState(() => Date.now() - 14 * 60 * 1000 - 30_000);
  const [overAt] = useState(() => Date.now() - 16 * 60 * 1000);
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <BigTimer timer={{ startedAt, pausedAt: null, endedAt: null, pausedDurationMs: 0, durationSec: 900 }} />
      <BigTimer
        timer={{ startedAt: overAt, pausedAt: null, endedAt: null, pausedDurationMs: 0, durationSec: 900 }}
      />
    </div>
  );
}
