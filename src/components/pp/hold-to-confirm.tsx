"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Press-and-hold button for destructive or final actions. Hard to trigger by
 * accident in a noisy environment. Works with pointer and keyboard (hold Space/Enter).
 */
export function HoldToConfirm({
  onConfirm,
  children,
  holdMs = 1200,
  disabled,
  tone = "destructive",
  className,
}: {
  onConfirm: () => void;
  children: ReactNode;
  holdMs?: number;
  disabled?: boolean;
  tone?: "destructive" | "primary" | "success";
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);

  const stop = useCallback(() => {
    startRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || startRef.current != null) return;
    startRef.current = performance.now();
    const loop = () => {
      if (startRef.current == null) return;
      const p = Math.min(1, (performance.now() - startRef.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        startRef.current = null;
        frameRef.current = null;
        confirmRef.current();
        setTimeout(() => setProgress(0), 400);
        return;
      }
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
  }, [disabled, holdMs]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const toneClass = {
    destructive: "border-destructive text-destructive [--fill:var(--destructive)]",
    primary: "border-primary text-primary [--fill:var(--primary)]",
    success: "border-success text-success [--fill:var(--success)]",
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "font-display relative isolate inline-flex min-h-14 w-full cursor-pointer touch-none items-center justify-center overflow-hidden rounded-xl border-2 px-6 text-xl select-none disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
        className,
      )}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 -z-10 bg-(--fill)/25"
        style={{ width: `${progress * 100}%` }}
      />
      <span>{children}</span>
      <span className="sr-only">Gedrückt halten zum Bestätigen</span>
    </button>
  );
}
