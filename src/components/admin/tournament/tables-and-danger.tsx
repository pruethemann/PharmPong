"use client";

import { useState } from "react";
import { Ban, Check, Loader2, Lock, LockOpen, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { TableBadge } from "@/components/pp/table-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, ReasonField, TypedConfirmField, aria, reasonOk } from "@/components/admin/fields";
import { TableStatePill } from "@/components/admin/live-bits";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import type { LiveTable } from "@/lib/live-types";
import type { TournamentStatusKey } from "@/lib/i18n/de";
import {
  cancelTournamentAction,
  renameTableAction,
  resetDrawAction,
  setTableDisabledAction,
} from "@/server/actions/tournament";

type Runner = ReturnType<typeof useAdminAction>;

function TableRow({ table, runner, online }: { table: LiveTable; runner: Runner; online: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(table.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toggle, setToggle] = useState(false);
  const [reason, setReason] = useState("");
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const disabling = table.state !== "DISABLED";
  const id = `table-${table.id}`;

  return (
    <li className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <TableBadge number={table.number} size="md" muted={table.state === "DISABLED"} />
          {!editing && <span className="truncate font-semibold">{table.name}</span>}
        </div>
        <TableStatePill state={table.state} />
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setNameError(null);
            const res = await runner.run(
              `rename-${table.id}`,
              () => renameTableAction({ tableId: table.id, name }),
              {
                success: "Tisch umbenannt.",
                onError: (f) => {
                  setNameError(f.fieldErrors?.name ?? f.message);
                  return true;
                },
              },
            );
            if (res?.ok) setEditing(false);
          }}
        >
          <AdminField id={`${id}-name`} label="Tischname" error={nameError} className="flex-1">
            <Input
              {...aria(`${id}-name`, nameError)}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </AdminField>
          <div className="flex gap-2">
            <Button type="submit" disabled={!online || runner.pending !== null || !name.trim()}>
              <Check aria-hidden="true" /> Speichern
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Zurück
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setName(table.name);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" /> Umbenennen
          </Button>
          <Button
            variant={disabling ? "destructive" : "success"}
            disabled={!online || runner.pending !== null}
            onClick={() => {
              setReason("");
              setBusyMsg(null);
              setToggle(true);
            }}
          >
            {disabling ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
            {disabling ? "Sperren" : "Freigeben"}
          </Button>
        </div>
      )}
      <AdminDialog
        open={toggle}
        onOpenChange={setToggle}
        tone={disabling ? "destructive" : "default"}
        title={disabling ? `Tisch ${table.number} sperren?` : `Tisch ${table.number} freigeben?`}
        description={
          disabling
            ? "Ein gesperrter Tisch erhält keine Spiele. Nur möglich, wenn dort kein Spiel aktiv ist."
            : "Der Tisch steht danach wieder für Zuweisungen bereit."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setToggle(false)}>
              Zurück
            </Button>
            <Button
              variant={disabling ? "destructive-solid" : "success"}
              disabled={!online || runner.pending !== null || (disabling && !reasonOk(reason))}
              onClick={async () => {
                const res = await runner.run(
                  `toggle-${table.id}`,
                  () =>
                    setTableDisabledAction({ tableId: table.id, disabled: disabling, reason: reason.trim() }),
                  {
                    success: disabling
                      ? `Tisch ${table.number} gesperrt.`
                      : `Tisch ${table.number} freigegeben.`,
                    onError: (f) => {
                      if (f.code === "TABLE_BUSY") {
                        setBusyMsg(f.message);
                        return true;
                      }
                      return false;
                    },
                  },
                );
                if (res?.ok) setToggle(false);
              }}
            >
              {runner.pending === `toggle-${table.id}` && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              {disabling ? "Tisch sperren" : "Tisch freigeben"}
            </Button>
          </>
        }
      >
        <ReasonField
          id={`${id}-reason`}
          value={reason}
          onChange={setReason}
          min={disabling ? 3 : 0}
          label={disabling ? "Begründung (fürs Audit-Log)" : "Begründung (optional)"}
          placeholder={disabling ? "z. B. Tischbein wackelt" : "z. B. repariert"}
        />
        {busyMsg && (
          <p role="alert" className="text-destructive flex items-start gap-2 font-semibold">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {busyMsg}
          </p>
        )}
      </AdminDialog>
    </li>
  );
}

export function TablesAdmin({
  tables,
  runner,
  online,
}: {
  tables: LiveTable[];
  runner: Runner;
  online: boolean;
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
      {tables.map((t) => (
        <TableRow key={t.id} table={t} runner={runner} online={online} />
      ))}
    </ul>
  );
}

const RESET_TEXT = "AUSLOSUNG ZURÜCKSETZEN";
const CANCEL_TEXT = "TURNIER ABBRECHEN";

export function DangerZone({
  status,
  drawExists,
  runner,
  online,
}: {
  status: TournamentStatusKey;
  drawExists: boolean;
  runner: Runner;
  online: boolean;
}) {
  const [open, setOpen] = useState<null | "reset" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const canReset = drawExists && ["REGISTRATION_LOCKED", "GROUP_STAGE", "KNOCKOUT_STAGE"].includes(status);
  const canCancel = status !== "COMPLETED" && status !== "CANCELLED";
  const expected = open === "reset" ? RESET_TEXT : CANCEL_TEXT;
  const minReason = open === "reset" ? 5 : 3;

  const start = (k: "reset" | "cancel") => {
    setReason("");
    setConfirmText("");
    setOpen(k);
  };

  return (
    <section
      aria-labelledby="danger-title"
      className="border-destructive/70 bg-destructive/5 flex flex-col gap-4 rounded-2xl border-2 p-5"
    >
      <h2 id="danger-title" className="text-destructive flex items-center gap-2 text-2xl leading-none">
        <TriangleAlert className="size-6" aria-hidden="true" /> Gefahrenzone
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg leading-none">Auslosung zurücksetzen</h3>
          <p className="text-muted-foreground text-sm">
            Löscht Gruppen und alle Spiele; die Anmeldung ist danach wieder gesperrt. Alles wird vorher im
            Audit-Log gesichert.
          </p>
          <Button
            variant="destructive"
            disabled={!online || !canReset}
            onClick={() => start("reset")}
            className="self-start"
          >
            <RotateCcw aria-hidden="true" /> Auslosung zurücksetzen
          </Button>
          {!canReset && (
            <p className="text-muted-foreground text-xs">Nur mit bestehender Auslosung vor Turnierende.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-lg leading-none">Turnier abbrechen</h3>
          <p className="text-muted-foreground text-sm">
            Sagt alle offenen Spiele ab und beendet das Turnier endgültig. Nicht umkehrbar.
          </p>
          <Button
            variant="destructive"
            disabled={!online || !canCancel}
            onClick={() => start("cancel")}
            className="self-start"
          >
            <Ban aria-hidden="true" /> Turnier abbrechen
          </Button>
        </div>
      </div>
      <AdminDialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        tone="destructive"
        title={open === "reset" ? "Auslosung zurücksetzen?" : "Turnier abbrechen?"}
        description={
          open === "reset"
            ? "Alle Gruppen, Spiele und Resultate dieser Auslosung werden entfernt (Snapshot im Audit-Log)."
            : "Alle offenen Spiele werden abgesagt. Das Turnier kann danach nicht fortgesetzt werden."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={
                !online ||
                runner.pending !== null ||
                confirmText.trim() !== expected ||
                !reasonOk(reason, minReason)
              }
              onClick={async () => {
                const payload = { reason: reason.trim(), confirmText: confirmText.trim() };
                const res =
                  open === "reset"
                    ? await runner.run("reset-draw", () => resetDrawAction(payload), {
                        success: "Auslosung zurückgesetzt.",
                      })
                    : await runner.run("cancel", () => cancelTournamentAction(payload), {
                        success: "Turnier abgebrochen.",
                      });
                if (res?.ok) setOpen(null);
              }}
            >
              {runner.pending !== null && <Loader2 className="animate-spin" aria-hidden="true" />}
              {open === "reset" ? "Endgültig zurücksetzen" : "Endgültig abbrechen"}
            </Button>
          </>
        }
      >
        <ReasonField id="danger-reason" value={reason} onChange={setReason} min={minReason} />
        <TypedConfirmField
          id="danger-confirm"
          expected={expected}
          value={confirmText}
          onChange={setConfirmText}
        />
      </AdminDialog>
    </section>
  );
}
