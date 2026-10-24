"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  CloudOff,
  Copy,
  KeyRound,
  Loader2,
  LockOpen,
  Power,
  PowerOff,
  Search,
  ShieldCheck,
} from "lucide-react";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";
import { EmptyState, Section } from "@/components/pp/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, NativeSelect, aria } from "@/components/admin/fields";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { useOnline } from "@/components/admin/use-online";
import { formatZurich } from "@/lib/admin-labels";
import { roleLabel, type RoleKey } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";
import {
  createResetLinkAction,
  getUserCountsAction,
  listUsersAction,
  setActiveAction,
  setRoleAction,
  unlockLoginAction,
} from "@/server/actions/users";

export type AdminUserView = {
  id: string;
  email: string;
  displayName: string;
  role: RoleKey;
  isActive: boolean;
  mustChangePassword: boolean;
  team: { id: string; name: string } | null;
};

const ROLES: RoleKey[] = ["PLAYER", "REFEREE", "ADMIN"];

/** Totals over all accounts (role counts are active accounts only). */
export type AdminUserCounts = { players: number; referees: number; admins: number; inactive: number };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function RoleBadge({ role }: { role: RoleKey }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        role === "ADMIN" && "border-team-away/60 text-team-away",
        role === "REFEREE" && "border-primary/60 text-primary",
        role === "PLAYER" && "border-border text-muted-foreground",
      )}
    >
      {role !== "PLAYER" && <ShieldCheck className="size-3.5" aria-hidden="true" />}
      {roleLabel[role]}
    </span>
  );
}

type Pending =
  | { kind: "role"; user: AdminUserView; role: RoleKey }
  | { kind: "active"; user: AdminUserView }
  | { kind: "reset"; user: AdminUserView; url: string; expiresAt: string };

export function AdminUsers({
  initial,
  initialCounts,
  meId,
}: {
  initial: AdminUserView[];
  initialCounts: AdminUserCounts;
  meId: string;
}) {
  const router = useRouter();
  const online = useOnline();
  const [users, setUsers] = useState(initial);
  const [counts, setCounts] = useState(initialCounts);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [unlockEmail, setUnlockEmail] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const queryRef = useRef(query);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await listUsersAction({ query: q || undefined });
      if (res.ok && queryRef.current === q) setUsers(res.data as AdminUserView[]);
      else if (!res.ok) toast.error(res.message);
    } catch {
      toast.error("Keine Verbindung. Liste konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queryRef.current = query.trim();
    const t = setTimeout(() => void load(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const loadCounts = useCallback(async () => {
    try {
      const res = await getUserCountsAction();
      if (res.ok) setCounts(res.data);
    } catch {
      // keep last known totals; the list reload reports connection problems
    }
  }, []);

  const refresh = useCallback(() => {
    void load(queryRef.current);
    void loadCounts();
    router.refresh();
  }, [load, loadCounts, router]);
  const runner = useAdminAction(refresh);
  const busy = !online || runner.pending !== null;

  const total = counts.players + counts.referees + counts.admins + counts.inactive;
  const searching = query.trim().length > 0;

  async function createReset(u: AdminUserView) {
    await runner.run(`reset-${u.id}`, () => createResetLinkAction({ userId: u.id }), {
      onOk: (d) => {
        setCopied(false);
        setDialog({ kind: "reset", user: u, url: d.url, expiresAt: d.expiresAt });
      },
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {!online && (
        <p
          role="status"
          className="bg-destructive text-destructive-foreground flex items-center gap-2 rounded-xl px-4 py-3 font-semibold"
        >
          <CloudOff className="size-5" aria-hidden="true" /> Offline: Aktionen sind gesperrt.
        </p>
      )}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="user-search" className="sr-only">
            Benutzer suchen
          </label>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="user-search"
            type="search"
            placeholder="Name oder E-Mail suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11"
          />
          {loading && (
            <Loader2
              className="text-muted-foreground absolute top-1/2 right-3.5 size-5 -translate-y-1/2 animate-spin"
              aria-hidden="true"
            />
          )}
        </div>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {searching && (
            <span className="text-foreground font-semibold">
              {plural(users.length, "Treffer", "Treffer")} von {plural(total, "Konto", "Konten")}
            </span>
          )}
          {!searching && (
            <>
              {plural(total, "Konto", "Konten")} · {plural(counts.admins, "Admin", "Admins")} ·{" "}
              {plural(counts.referees, "Schiri", "Schiris")} · {counts.inactive} deaktiviert
            </>
          )}
        </p>
      </div>

      {users.length === 0 ? (
        <EmptyState title="Keine Treffer">Suche anpassen.</EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {users.map((u) => {
            const me = u.id === meId;
            return (
              <li
                key={u.id}
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-2xl border p-4",
                  !u.isActive && "border-dashed opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">
                      {u.displayName}
                      {me && <span className="text-muted-foreground text-sm font-normal">{" (du)"}</span>}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">{u.email}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <RoleBadge role={u.role} />
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-semibold",
                        u.isActive ? "text-success" : "text-destructive",
                      )}
                    >
                      {u.isActive ? (
                        <Power className="size-3.5" aria-hidden="true" />
                      ) : (
                        <PowerOff className="size-3.5" aria-hidden="true" />
                      )}
                      {u.isActive ? "Aktiv" : "Deaktiviert"}
                    </span>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  Team: <span className="text-foreground">{u.team?.name ?? "–"}</span>
                  {u.mustChangePassword && <span className="text-warning"> · muss Passwort ändern</span>}
                </p>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                  <AdminField id={`role-${u.id}`} label="Rolle">
                    <NativeSelect
                      id={`role-${u.id}`}
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => {
                        setRoleError(null);
                        setDialog({ kind: "role", user: u, role: e.target.value as RoleKey });
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel[r]}
                        </option>
                      ))}
                    </NativeSelect>
                  </AdminField>
                  <Button
                    variant="outline"
                    disabled={busy || !u.isActive}
                    onClick={() => void createReset(u)}
                  >
                    {runner.pending === `reset-${u.id}` ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <KeyRound aria-hidden="true" />
                    )}
                    Reset-Link erstellen
                  </Button>
                  <Button
                    variant={u.isActive ? "destructive" : "success"}
                    disabled={busy || (me && u.isActive)}
                    title={me && u.isActive ? "Eigenes Konto kann nicht deaktiviert werden" : undefined}
                    onClick={() => setDialog({ kind: "active", user: u })}
                  >
                    {u.isActive ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                    {u.isActive ? "Deaktivieren" : "Aktivieren"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Section title="Login-Sperren">
        <div className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
          <p className="text-muted-foreground text-sm">
            Nach zu vielen Fehlversuchen wird ein Login vorübergehend gesperrt. Hier kannst du die Sperre
            sofort aufheben.
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              setUnlockError(null);
              await runner.run("unlock-one", () => unlockLoginAction({ email: unlockEmail.trim() }), {
                success: (d) =>
                  d.cleared
                    ? `Sperre für ${unlockEmail.trim()} aufgehoben.`
                    : "Für diese Adresse bestand keine Sperre.",
                onOk: () => setUnlockEmail(""),
                onError: (f) => {
                  setUnlockError(f.fieldErrors?.email ?? f.message);
                  return true;
                },
              });
            }}
          >
            <AdminField id="unlock-email" label="E-Mail-Adresse" error={unlockError} className="flex-1">
              <Input
                {...aria("unlock-email", unlockError)}
                type="email"
                autoComplete="off"
                value={unlockEmail}
                onChange={(e) => setUnlockEmail(e.target.value)}
              />
            </AdminField>
            <Button type="submit" disabled={busy || !unlockEmail.trim()}>
              <LockOpen aria-hidden="true" /> Sperre aufheben
            </Button>
          </form>
          <Button
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() =>
              runner.run("unlock-all", () => unlockLoginAction({ email: "" }), {
                success: (d) => `${d.cleared} Sperre${d.cleared === 1 ? "" : "n"} aufgehoben.`,
              })
            }
          >
            {runner.pending === "unlock-all" ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <LockOpen aria-hidden="true" />
            )}
            Alle Login-Sperren aufheben
          </Button>
        </div>
      </Section>

      {dialog?.kind === "role" && (
        <AdminDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title="Rolle ändern?"
          description={`${dialog.user.displayName}: ${roleLabel[dialog.user.role]} → ${roleLabel[dialog.role]}. Die Person wird abgemeldet und meldet sich mit der neuen Rolle wieder an.`}
          tone={dialog.role === "ADMIN" || dialog.user.role === "ADMIN" ? "destructive" : "default"}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Zurück
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  const res = await runner.run(
                    "role",
                    () => setRoleAction({ userId: dialog.user.id, role: dialog.role }),
                    {
                      success: `${dialog.user.displayName} ist jetzt ${roleLabel[dialog.role]}.`,
                      onError: (f) => {
                        setRoleError(f.message);
                        return true;
                      },
                    },
                  );
                  if (res?.ok) setDialog(null);
                }}
              >
                {runner.pending === "role" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                Rolle ändern
              </Button>
            </>
          }
        >
          {roleError && (
            <p role="alert" className="text-destructive font-semibold">
              {roleError}
            </p>
          )}
        </AdminDialog>
      )}

      {dialog?.kind === "active" && (
        <AdminDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          tone={dialog.user.isActive ? "destructive" : "default"}
          title={
            dialog.user.isActive
              ? `${dialog.user.displayName} deaktivieren?`
              : `${dialog.user.displayName} aktivieren?`
          }
          description={
            dialog.user.isActive
              ? "Alle Sitzungen werden beendet, Login ist nicht mehr möglich. Teamzugehörigkeit bleibt."
              : "Die Person kann sich wieder anmelden."
          }
        >
          <HoldToConfirm
            tone={dialog.user.isActive ? "destructive" : "success"}
            disabled={busy}
            onConfirm={async () => {
              const u = dialog.user;
              const res = await runner.run(
                "active",
                () => setActiveAction({ userId: u.id, isActive: !u.isActive }),
                {
                  success: u.isActive ? `${u.displayName} deaktiviert.` : `${u.displayName} aktiviert.`,
                },
              );
              if (res?.ok) setDialog(null);
            }}
          >
            {runner.pending === "active"
              ? "Wird gespeichert …"
              : dialog.user.isActive
                ? "Halten: deaktivieren"
                : "Halten: aktivieren"}
          </HoldToConfirm>
        </AdminDialog>
      )}

      {dialog?.kind === "reset" && (
        <AdminDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title="Reset-Link erstellt"
          description={`Reset-Link für «${dialog.user.displayName}»: wird nur jetzt angezeigt, ist einmal verwendbar und frühere Links sind ungültig.`}
          footer={<Button onClick={() => setDialog(null)}>Fertig</Button>}
        >
          <AdminField
            id="reset-url"
            label="Link"
            hint={`Gültig bis ${formatZurich(dialog.expiresAt, "datetime")} (Zürich).`}
          >
            <div className="flex gap-2">
              <Input
                {...aria("reset-url", null, true)}
                readOnly
                value={dialog.url}
                className="font-mono text-sm"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Link kopieren"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(dialog.url);
                    setCopied(true);
                    toast.success("Link kopiert.");
                  } catch {
                    toast.error("Kopieren nicht möglich. Bitte Link markieren und manuell kopieren.");
                  }
                }}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            </div>
          </AdminField>
          <p className="text-muted-foreground text-sm">
            Persönlich oder per Direktnachricht übergeben, nie öffentlich teilen.
          </p>
        </AdminDialog>
      )}
    </div>
  );
}
