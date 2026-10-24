"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CloudOff,
  Hourglass,
  Loader2,
  MessageSquareQuote,
  Pencil,
  Plus,
  Replace,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { EmptyState } from "@/components/pp/section";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { TeamStatusBadge } from "@/components/team/team-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { AdminField, NativeSelect, ReasonField, aria, reasonOk } from "@/components/admin/fields";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { useOnline } from "@/components/admin/use-online";
import type { ActionResult } from "@/lib/action-result";
import { tournamentStatusLabel, type TournamentStatusKey } from "@/lib/i18n/de";
import { MOTTO_MAX, TEAM_NAME_MAX } from "@/lib/validation/team";
import { cn } from "@/lib/utils";
import {
  adminAddMemberAction,
  adminCreateTeamAction,
  adminDissolveTeamAction,
  adminRemoveMemberAction,
  adminReplaceMemberAction,
  adminRenameTeamAction,
  adminSetMottoAction,
} from "@/server/actions/teams";

export type AdminTeamView = {
  id: string;
  name: string;
  motto: string | null;
  logoUrl: string | null;
  status: "ACTIVE" | "DISSOLVED";
  inviteCode: string;
  complete: boolean;
  allReady: boolean;
  members: { userId: string; displayName: string; email: string; slot: number; isReady: boolean }[];
};
export type FreeUser = { id: string; displayName: string; email: string };

type Mode =
  | { kind: "rename"; team: AdminTeamView }
  | { kind: "motto"; team: AdminTeamView }
  | { kind: "add"; team: AdminTeamView }
  | { kind: "replace"; team: AdminTeamView; userId: string }
  | { kind: "remove"; team: AdminTeamView; userId: string }
  | { kind: "dissolve"; team: AdminTeamView }
  | { kind: "create" };

function UserPicker({
  id,
  label,
  users,
  value,
  onChange,
  exclude = [],
}: {
  id: string;
  label: string;
  users: FreeUser[];
  value: string;
  onChange: (v: string) => void;
  exclude?: string[];
}) {
  const options = users.filter((u) => !exclude.includes(u.id));
  return (
    <AdminField
      id={id}
      label={label}
      hint={
        options.length === 0
          ? "Keine aktiven Personen ohne Team vorhanden."
          : `${options.length} Personen ohne Team.`
      }
    >
      <NativeSelect {...aria(id, null, true)} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Person wählen …</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName} · {u.email}
          </option>
        ))}
      </NativeSelect>
    </AdminField>
  );
}

function TeamDialog({
  mode,
  onClose,
  freeUsers,
  runner,
  online,
}: {
  mode: Mode | null;
  onClose: () => void;
  freeUsers: FreeUser[];
  runner: ReturnType<typeof useAdminAction>;
  online: boolean;
}) {
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");
  const [userA, setUserA] = useState("");
  const [userB, setUserB] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<Mode | null>(null);

  // Reset the form whenever a new dialog opens (render-time state sync).
  if (mode !== lastMode) {
    setLastMode(mode);
    setName(mode && "team" in mode ? mode.team.name : "");
    setMotto(mode && "team" in mode ? (mode.team.motto ?? "") : "");
    setUserA("");
    setUserB("");
    setReason("");
    setFieldError(null);
  }
  if (!mode) return null;

  const team = "team" in mode ? mode.team : null;
  const member =
    mode.kind === "replace" || mode.kind === "remove"
      ? team?.members.find((m) => m.userId === mode.userId)
      : null;

  const config: {
    title: string;
    description?: string;
    cta: string;
    destructive?: boolean;
    valid: boolean;
    exec: () => Promise<ActionResult<unknown>>;
    success: string;
  } = (() => {
    const r = reason.trim();
    switch (mode.kind) {
      case "rename":
        return {
          title: `«${mode.team.name}» umbenennen`,
          cta: "Umbenennen",
          valid: name.trim().length >= 2 && name.trim() !== mode.team.name,
          exec: () => adminRenameTeamAction({ teamId: mode.team.id, name, reason: r }),
          success: "Team umbenannt.",
        };
      case "motto":
        return {
          title: "Motto ändern",
          description: mode.team.name,
          cta: "Motto speichern",
          valid: motto.trim() !== (mode.team.motto ?? ""),
          exec: () => adminSetMottoAction({ teamId: mode.team.id, motto, reason: r }),
          success: "Motto gespeichert.",
        };
      case "add":
        return {
          title: "Mitglied hinzufügen",
          description: mode.team.name,
          cta: "Hinzufügen",
          valid: !!userA,
          exec: () => adminAddMemberAction({ teamId: mode.team.id, userId: userA, reason: r }),
          success: "Mitglied hinzugefügt.",
        };
      case "replace":
        return {
          title: `${member?.displayName ?? "Person"} ersetzen`,
          description: `Team ${mode.team.name}. Spielplan und Resultate bleiben unverändert.`,
          cta: "Ersetzen",
          valid: !!userA,
          exec: () =>
            adminReplaceMemberAction({
              teamId: mode.team.id,
              oldUserId: mode.userId,
              newUserId: userA,
              reason: r,
            }),
          success: "Mitglied ersetzt.",
        };
      case "remove":
        return {
          title: `${member?.displayName ?? "Person"} entfernen?`,
          description:
            mode.team.members.length === 1
              ? "Letztes Mitglied: Vor der Gruppenphase wird das Team dabei aufgelöst."
              : `Aus Team ${mode.team.name}. Das Team ist danach unvollständig.`,
          cta: "Entfernen",
          destructive: true,
          valid: true,
          exec: () => adminRemoveMemberAction({ teamId: mode.team.id, userId: mode.userId, reason: r }),
          success: "Mitglied entfernt.",
        };
      case "dissolve":
        return {
          title: `«${mode.team.name}» auflösen?`,
          description: "Beide Mitglieder werden frei, der Name wird wieder verfügbar.",
          cta: "Team auflösen",
          destructive: true,
          valid: true,
          exec: () => adminDissolveTeamAction({ teamId: mode.team.id, reason: r }),
          success: "Team aufgelöst.",
        };
      case "create":
        return {
          title: "Team erstellen",
          description: "Für Anmeldeprobleme: Team im Namen von zwei Personen anlegen.",
          cta: "Team erstellen",
          valid: name.trim().length >= 2 && !!userA && !!userB && userA !== userB,
          exec: () =>
            adminCreateTeamAction({ name, motto: motto || null, memberUserIds: [userA, userB], reason: r }),
          success: "Team erstellt.",
        };
    }
  })();

  async function submit() {
    setFieldError(null);
    const res = await runner.run(mode!.kind, config.exec, {
      success: config.success,
      onError: (f) => {
        if (f.code === "NAME_TAKEN" || f.fieldErrors?.name) {
          setFieldError(f.fieldErrors?.name ?? f.message);
          return true;
        }
        return false;
      },
    });
    if (res?.ok) onClose();
  }

  return (
    <AdminDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={config.title}
      description={config.description}
      tone={config.destructive ? "destructive" : "default"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zurück
          </Button>
          <Button
            variant={config.destructive ? "destructive-solid" : "default"}
            disabled={!online || runner.pending !== null || !config.valid || !reasonOk(reason)}
            onClick={() => void submit()}
          >
            {runner.pending !== null && <Loader2 className="animate-spin" aria-hidden="true" />}
            {config.cta}
          </Button>
        </>
      }
    >
      {(mode.kind === "rename" || mode.kind === "create") && (
        <AdminField id="team-name" label="Teamname" error={fieldError} hint={`2–${TEAM_NAME_MAX} Zeichen.`}>
          <Input
            {...aria("team-name", fieldError, true)}
            value={name}
            maxLength={TEAM_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </AdminField>
      )}
      {(mode.kind === "motto" || mode.kind === "create") && (
        <AdminField
          id="team-motto"
          label="Motto (optional)"
          hint={`Höchstens ${MOTTO_MAX} Zeichen. Leer = kein Motto.`}
        >
          <Input
            {...aria("team-motto", null, true)}
            value={motto}
            maxLength={MOTTO_MAX}
            onChange={(e) => setMotto(e.target.value)}
          />
        </AdminField>
      )}
      {(mode.kind === "add" || mode.kind === "replace" || mode.kind === "create") && (
        <UserPicker
          id="team-user-a"
          label={mode.kind === "replace" ? "Neue Person" : mode.kind === "create" ? "Mitglied 1" : "Person"}
          users={freeUsers}
          value={userA}
          onChange={setUserA}
        />
      )}
      {mode.kind === "create" && (
        <UserPicker
          id="team-user-b"
          label="Mitglied 2"
          users={freeUsers}
          value={userB}
          onChange={setUserB}
          exclude={[userA]}
        />
      )}
      <ReasonField
        id="team-reason"
        value={reason}
        onChange={setReason}
        max={300}
        placeholder="z. B. Person krank, Ersatz vor Ort"
      />
    </AdminDialog>
  );
}

export function AdminTeams({
  teams,
  freeUsers,
  status,
}: {
  teams: AdminTeamView[];
  freeUsers: FreeUser[];
  status: TournamentStatusKey;
}) {
  const router = useRouter();
  const online = useOnline();
  const refresh = useCallback(() => router.refresh(), [router]);
  const runner = useAdminAction(refresh);
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [showDissolved, setShowDissolved] = useState(false);
  const canDissolve = ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_LOCKED"].includes(status);
  const finished = status === "COMPLETED" || status === "CANCELLED";

  const active = teams.filter((t) => t.status === "ACTIVE");
  const dissolved = teams.filter((t) => t.status === "DISSOLVED");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (showDissolved ? teams : active).filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.members.some((m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
      ),
    [teams, active, showDissolved, q],
  );
  const complete = active.filter((t) => t.complete).length;

  return (
    <div className="flex flex-col gap-5">
      {!online && (
        <p
          role="status"
          className="bg-destructive text-destructive-foreground flex items-center gap-2 rounded-xl px-4 py-3 font-semibold"
        >
          <CloudOff className="size-5" aria-hidden="true" /> Offline: Aktionen sind gesperrt.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-muted-foreground" aria-live="polite">
          <span className="text-foreground font-semibold">{complete}/12</span> Teams komplett ·{" "}
          {active.length} aktiv · {freeUsers.length} Personen ohne Team · Phase:{" "}
          {tournamentStatusLabel[status]}
        </p>
        <Button size="lg" disabled={!online || finished} onClick={() => setMode({ kind: "create" })}>
          <Plus aria-hidden="true" /> Team erstellen
        </Button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="team-search" className="sr-only">
            Teams oder Personen suchen
          </label>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="team-search"
            type="search"
            placeholder="Team, Name oder E-Mail suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11"
          />
        </div>
        {dissolved.length > 0 && (
          <Button variant="outline" aria-pressed={showDissolved} onClick={() => setShowDissolved((v) => !v)}>
            {showDissolved ? "Aufgelöste ausblenden" : `Aufgelöste zeigen (${dissolved.length})`}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={teams.length === 0 ? "Noch keine Teams" : "Keine Treffer"}>
          {teams.length === 0 ? "Teams entstehen, sobald die Anmeldung offen ist." : "Suche anpassen."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => {
            const isActive = t.status === "ACTIVE";
            return (
              <li
                key={t.id}
                className={cn(
                  "bg-card flex flex-col gap-4 rounded-2xl border p-4",
                  !isActive && "opacity-60",
                  isActive && !t.complete && "border-warning/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <TeamAvatar name={t.name} logoUrl={t.logoUrl} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="font-display truncate text-2xl leading-none">{t.name}</p>
                    {t.motto && <p className="text-muted-foreground truncate text-sm italic">«{t.motto}»</p>}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {isActive ? (
                        <TeamStatusBadge complete={t.complete} className="px-2 py-0.5 text-xs" />
                      ) : (
                        <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-semibold">
                          Aufgelöst
                        </span>
                      )}
                      {isActive && t.complete && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                            t.allReady
                              ? "border-success/60 text-success"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {t.allReady ? (
                            <CircleCheck className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Hourglass className="size-3.5" aria-hidden="true" />
                          )}
                          {t.allReady ? "Bereit" : "Nicht bereit"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  Einladungscode:{" "}
                  <span className="text-foreground font-mono font-semibold tracking-wider">
                    {t.inviteCode}
                  </span>
                </p>
                <ul className="flex flex-col gap-2" aria-label={`Mitglieder ${t.name}`}>
                  {t.members.map((m) => (
                    <li key={m.userId} className="bg-muted/30 flex flex-col gap-2 rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {m.displayName}
                          {m.isReady && (
                            <CircleCheck className="text-success ml-1.5 inline size-4" aria-label="bereit" />
                          )}
                        </p>
                        <p className="text-muted-foreground truncate text-sm">{m.email}</p>
                      </div>
                      {isActive && !finished && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-12 flex-1 lg:h-10"
                            disabled={!online}
                            onClick={() => setMode({ kind: "replace", team: t, userId: m.userId })}
                          >
                            <Replace aria-hidden="true" /> Ersetzen
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-12 flex-1 lg:h-10"
                            disabled={!online}
                            onClick={() => setMode({ kind: "remove", team: t, userId: m.userId })}
                          >
                            <UserMinus aria-hidden="true" /> Entfernen
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                  {isActive && t.members.length < 2 && (
                    <li>
                      <Button
                        variant="warning"
                        className="w-full"
                        disabled={!online || finished}
                        onClick={() => setMode({ kind: "add", team: t })}
                      >
                        <UserPlus aria-hidden="true" /> Mitglied hinzufügen
                      </Button>
                    </li>
                  )}
                </ul>
                {isActive && !finished && (
                  <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-12 lg:h-10"
                      disabled={!online}
                      onClick={() => setMode({ kind: "rename", team: t })}
                    >
                      <Pencil aria-hidden="true" /> Umbenennen
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-12 lg:h-10"
                      disabled={!online}
                      onClick={() => setMode({ kind: "motto", team: t })}
                    >
                      <MessageSquareQuote aria-hidden="true" /> Motto
                    </Button>
                    {canDissolve && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive h-12 lg:h-10"
                        disabled={!online}
                        onClick={() => setMode({ kind: "dissolve", team: t })}
                      >
                        <Trash2 aria-hidden="true" /> Auflösen
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <TeamDialog
        mode={mode}
        onClose={() => setMode(null)}
        freeUsers={freeUsers}
        runner={runner}
        online={online}
      />
    </div>
  );
}
