"use client";

import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reportIssueAction } from "@/server/actions/matches";
import type { RunFn } from "./use-match-action";

const MAX = 300;

/** "Problem melden": notifies the tournament admin about a match. */
export function ReportIssueDialog({
  matchId,
  matchLabel,
  disabled,
  pending,
  run,
}: {
  matchId: string;
  matchLabel: string;
  disabled: boolean;
  pending: boolean;
  run: RunFn;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const trimmed = text.trim();

  async function submit() {
    if (trimmed.length < 3) {
      setError("Bitte beschreibe das Problem in mindestens 3 Zeichen.");
      return;
    }
    const out = await run("issue", () => reportIssueAction({ matchId, text: trimmed }), {
      successToast: "Problem gemeldet. Die Turnierleitung ist informiert.",
    });
    if (out.kind === "ok") {
      setText("");
      setError(null);
      setOpen(false);
    } else if (out.kind === "error") {
      setError(out.result.fieldErrors?.text ?? out.result.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="text-warning hover:text-warning w-full sm:w-auto"
            disabled={disabled}
          />
        }
      >
        <TriangleAlert aria-hidden="true" /> Problem melden
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Problem melden</DialogTitle>
          <DialogDescription className="text-base">
            {matchLabel}: Die Turnierleitung sieht deine Meldung sofort. Das Spiel läuft normal weiter.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={fieldId} className="text-base">
            Was ist los?
          </Label>
          <Textarea
            id={fieldId}
            value={text}
            maxLength={MAX}
            rows={4}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            placeholder="z. B. Team B ist nicht erschienen, Tisch wackelt, Streit um einen Treffer …"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="min-h-28 text-base"
          />
          <div className="flex items-start justify-between gap-2 text-sm">
            {error ? (
              <p id={errorId} className="text-destructive font-semibold" role="alert">
                {error}
              </p>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground tabular shrink-0">
              {text.length}/{MAX}
            </span>
          </div>
          <DialogFooter className="-mx-5 mt-2 -mb-5">
            <DialogClose render={<Button variant="outline" type="button" />}>Abbrechen</DialogClose>
            <Button type="submit" variant="warning" disabled={pending || disabled}>
              {pending ? "Wird gesendet …" : "Meldung senden"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
