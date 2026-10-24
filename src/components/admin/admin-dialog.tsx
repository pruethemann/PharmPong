"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Dialog shell for admin forms: German close button (48px), scrollable body, footer actions. */
export function AdminDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  tone = "default",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "destructive";
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-card max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-lg",
          tone === "destructive" && "ring-destructive/60 ring-2",
          className,
        )}
      >
        <DialogHeader className="border-b p-4 pr-16">
          <DialogTitle className="font-display text-2xl leading-tight">{title}</DialogTitle>
          {description && <DialogDescription className="text-base">{description}</DialogDescription>}
        </DialogHeader>
        <DialogPrimitive.Close
          render={<Button variant="ghost" size="icon" className="absolute top-2 right-2" />}
          aria-label="Schliessen"
        >
          <XIcon aria-hidden="true" />
        </DialogPrimitive.Close>
        <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto p-4">{children}</div>
        {footer && <DialogFooter className="m-0 rounded-none p-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
