// Tournament lifecycle stepper for the admin "Turnier" page. Pure, client and server.
import type { TournamentStatusKey } from "@/lib/i18n/de";

export type LifecycleStep = { status: TournamentStatusKey; label: string };

export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  { status: "DRAFT", label: "Entwurf" },
  { status: "REGISTRATION_OPEN", label: "Anmeldung offen" },
  { status: "REGISTRATION_LOCKED", label: "Anmeldung gesperrt" },
  { status: "GROUP_STAGE", label: "Gruppenphase" },
  { status: "KNOCKOUT_STAGE", label: "K.-o.-Phase" },
  { status: "COMPLETED", label: "Beendet" },
];

/** Index of the current step; -1 for CANCELLED. */
export function stepIndex(status: TournamentStatusKey): number {
  return LIFECYCLE_STEPS.findIndex((s) => s.status === status);
}

export type LifecycleInput = {
  status: TournamentStatusKey;
  isPaused: boolean;
  /** Groups/fixtures exist. */
  drawExists: boolean;
  completeTeams: number;
  incompleteTeams: number;
  requiredTeams: number;
  groupMatchesTotal: number;
  groupMatchesDecided: number;
  /** Groups with an unresolved ranking tie. */
  unresolvedTieGroups: string[];
};

export type NextActionKind =
  "openRegistration" | "lockRegistration" | "generateDraw" | "startGroupStage" | "startKnockout" | "none";

export type Precondition = {
  label: string;
  met: boolean;
  /** Informational only: the server does not enforce it (shown as a warning). Default: blocking. */
  advisory?: boolean;
};

export type NextAction = {
  kind: NextActionKind;
  label: string;
  description: string;
  preconditions: Precondition[];
  /** True when at least one precondition is not met. */
  blocked: boolean;
};

function action(
  kind: NextActionKind,
  label: string,
  description: string,
  preconditions: Precondition[] = [],
): NextAction {
  return {
    kind,
    label,
    description,
    preconditions,
    blocked: preconditions.some((p) => !p.met && !p.advisory),
  };
}

/** Exactly one primary next action for the current phase, with its preconditions. */
export function nextAction(i: LifecycleInput): NextAction {
  switch (i.status) {
    case "DRAFT":
      return action(
        "openRegistration",
        "Anmeldung öffnen",
        "Spieler:innen können danach Teams gründen und beitreten.",
      );
    case "REGISTRATION_OPEN":
      return action(
        "lockRegistration",
        "Anmeldung sperren",
        "Danach können nur noch Admins Teams ändern. Die Anmeldung lässt sich bis zur Auslosung wieder öffnen.",
        [
          {
            label: `${i.completeTeams}/${i.requiredTeams} Teams komplett`,
            met: i.completeTeams === i.requiredTeams && i.incompleteTeams === 0,
            advisory: true,
          },
        ],
      );
    case "REGISTRATION_LOCKED":
      if (!i.drawExists) {
        return action(
          "generateDraw",
          "Gruppen auslosen",
          "Zufällige Auslosung von 12 Teams in 4 Gruppen à 3 Teams. Bis zum Start der Gruppenphase wiederholbar.",
          [
            {
              label: `Auslosung: ${i.completeTeams}/${i.requiredTeams} Teams komplett`,
              met: i.completeTeams === i.requiredTeams,
            },
            {
              label:
                i.incompleteTeams === 0
                  ? "Keine unvollständigen Teams"
                  : `${i.incompleteTeams} unvollständige${i.incompleteTeams === 1 ? "s" : ""} Team${i.incompleteTeams === 1 ? "" : "s"}`,
              met: i.incompleteTeams === 0,
            },
          ],
        );
      }
      return action(
        "startGroupStage",
        "Gruppenphase starten",
        "Gibt die 12 Gruppenspiele frei. Danach ist eine neue Auslosung nur noch über «Auslosung zurücksetzen» möglich.",
        [{ label: "Gruppen ausgelost", met: true }],
      );
    case "GROUP_STAGE":
      return action(
        "startKnockout",
        "K.-o.-Phase starten",
        "Setzt die Viertelfinals aus den Gruppenrängen (A1–B2, B1–A2, C1–D2, D1–C2).",
        [
          {
            label: `${i.groupMatchesDecided}/${i.groupMatchesTotal || 12} Gruppenspiele bestätigt`,
            met: i.groupMatchesTotal > 0 && i.groupMatchesDecided === i.groupMatchesTotal,
          },
          {
            label:
              i.unresolvedTieGroups.length === 0
                ? "Keine offenen Gleichstände"
                : `Gleichstand offen in Gruppe ${i.unresolvedTieGroups.join(", ")}`,
            met: i.unresolvedTieGroups.length === 0,
          },
        ],
      );
    case "KNOCKOUT_STAGE":
      return action(
        "none",
        "K.-o.-Phase läuft",
        "Das Turnier endet automatisch, sobald das Final bestätigt ist.",
      );
    case "COMPLETED":
      return action("none", "Turnier beendet", "Exportiere Rangliste und Resultate in der Übersicht.");
    case "CANCELLED":
      return action("none", "Turnier abgebrochen", "Die Historie bleibt im Audit-Log erhalten.");
  }
}

/** Server error details (GROUPS_INCOMPLETE / UNRESOLVED_TIE) → readable reasons. */
export function knockoutBlockReasons(code: string, details: Record<string, unknown> | undefined): string[] {
  if (code === "GROUPS_INCOMPLETE") {
    const pending = Array.isArray(details?.pending) ? (details.pending as unknown[]).map(String) : [];
    return pending.length
      ? [`Noch nicht bestätigt: ${pending.join(", ")}`]
      : ["Es sind noch nicht alle Gruppenspiele bestätigt."];
  }
  if (code === "UNRESOLVED_TIE") {
    const ties = Array.isArray(details?.ties) ? (details.ties as { group?: unknown }[]) : [];
    const groups = [...new Set(ties.map((t) => String(t.group ?? "?")))];
    return groups.length
      ? groups.map((g) => `Gruppe ${g}: Ranking-Shootout erfassen`)
      : ["Ein Gleichstand muss zuerst per Ranking-Shootout entschieden werden."];
  }
  return [];
}
