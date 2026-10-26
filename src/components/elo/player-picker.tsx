"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { formatRating, gamesLabel } from "@/lib/elo-format";
import type { EloRosterEntry, EloSideKey } from "@/lib/elo-live-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

type RowState =
  | { kind: "selected" }
  | { kind: "free" }
  | { kind: "otherSide" }
  | { kind: "busy"; table: number | null }
  | { kind: "full" };

/**
 * Bottom sheet to pick the players of one side. Tapping toggles a player; busy players, players of
 * the other side and a full team are disabled with the reason in words. Display names and ratings
 * only (never e-mail addresses).
 */
export function PlayerPicker({
  side,
  onClose,
  roster,
  sideA,
  sideB,
  maxTeamSize,
  meId,
  editMatchId,
  tableOfMatch,
  onToggle,
}: {
  side: EloSideKey | null;
  onClose: () => void;
  roster: readonly EloRosterEntry[];
  sideA: readonly string[];
  sideB: readonly string[];
  maxTeamSize: number;
  meId: string;
  /** Players of the edited draft are not "busy" for it. */
  editMatchId: string | null;
  tableOfMatch: (matchId: string) => number | null;
  onToggle: (side: EloSideKey, userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const mine = side === "A" ? sideA : sideB;
  const other = side === "A" ? sideB : sideA;
  const list = useMemo(() => {
    const q = fold(query.trim());
    const rows = roster.filter((r) => !q || fold(r.displayName).includes(q));
    // Me first, then alphabetical (the roster arrives sorted by name).
    return [...rows.filter((r) => r.userId === meId), ...rows.filter((r) => r.userId !== meId)];
  }, [roster, query, meId]);

  const stateOf = (r: EloRosterEntry): RowState => {
    if (mine.includes(r.userId)) return { kind: "selected" };
    if (other.includes(r.userId)) return { kind: "otherSide" };
    if (r.busyMatchId && r.busyMatchId !== editMatchId)
      return { kind: "busy", table: tableOfMatch(r.busyMatchId) };
    if (mine.length >= maxTeamSize) return { kind: "full" };
    return { kind: "free" };
  };

  return (
    <Sheet
      open={side != null}
      onOpenChange={(open) => {
        if (!open) {
          setQuery("");
          onClose();
        }
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full max-w-2xl rounded-t-3xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="font-display text-2xl">Team {side}: Spieler:innen</SheetTitle>
          <SheetDescription>
            Antippen zum Hinzufügen oder Entfernen. {mine.length} von höchstens {maxTeamSize} gewählt.
          </SheetDescription>
        </SheetHeader>
        <div className="relative px-4">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-7 size-5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name suchen"
            aria-label="Name suchen"
            className="pl-11"
            autoComplete="off"
          />
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4" aria-label="Spieler:innen">
          {list.length === 0 && <li className="text-muted-foreground p-4 text-center">Niemand gefunden.</li>}
          {list.map((r) => {
            const st = stateOf(r);
            const disabled = st.kind === "otherSide" || st.kind === "busy" || st.kind === "full";
            const reason =
              st.kind === "otherSide"
                ? `in Team ${side === "A" ? "B" : "A"}`
                : st.kind === "busy"
                  ? st.table != null
                    ? `spielt an Tisch ${st.table}`
                    : "spielt gerade"
                  : st.kind === "full"
                    ? "Team ist voll"
                    : null;
            return (
              <li key={r.userId}>
                <button
                  type="button"
                  aria-pressed={st.kind === "selected"}
                  disabled={disabled}
                  onClick={() => side && onToggle(side, r.userId)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    st.kind === "selected"
                      ? side === "A"
                        ? "border-team-home bg-team-home/10"
                        : "border-team-away bg-team-away/10"
                      : "hover:bg-muted border-transparent",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <PlayerAvatar userId={r.userId} name={r.displayName} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.displayName}
                      {r.userId === meId && <span className="text-primary"> (du)</span>}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      {formatRating(r.rating)} Elo · {gamesLabel(r.gamesPlayed)}
                      {reason && <> · {reason}</>}
                    </span>
                  </span>
                  {st.kind === "selected" && (
                    <Check
                      className={cn("size-6 shrink-0", side === "A" ? "text-team-home" : "text-team-away")}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <SheetFooter className="safe-bottom border-t pt-3">
          <Button size="lg" className="w-full" onClick={onClose}>
            Fertig
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
