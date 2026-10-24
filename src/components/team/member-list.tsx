import { CircleCheck, CircleDashed, UserPlus } from "lucide-react";
import { TeamAvatar } from "@/components/pp/team-avatar";

export type MemberView = { userId: string; displayName: string; isReady: boolean };

export function MemberList({ members, meId }: { members: MemberView[]; meId: string }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Mitglieder">
      {members.map((m) => (
        <li key={m.userId} className="bg-muted/50 flex items-center gap-3 rounded-xl p-3">
          <TeamAvatar name={m.displayName} size="sm" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {m.displayName}
            {m.userId === meId && <span className="text-muted-foreground font-normal"> (du)</span>}
          </span>
          {m.isReady ? (
            <span className="text-success inline-flex items-center gap-1.5 text-sm font-semibold">
              <CircleCheck className="size-4" aria-hidden="true" />
              Bereit
            </span>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
              <CircleDashed className="size-4" aria-hidden="true" />
              Noch nicht bereit
            </span>
          )}
        </li>
      ))}
      {members.length < 2 && (
        <li className="text-muted-foreground flex items-center gap-3 rounded-xl border border-dashed p-3">
          <span className="bg-muted inline-flex size-8 items-center justify-center rounded-2xl">
            <UserPlus className="size-4" aria-hidden="true" />
          </span>
          Freier Platz für deine:n Partner:in
        </li>
      )}
    </ul>
  );
}
