import { describe, expect, it } from "vitest";
import {
  assertEloAction,
  ELO_MATCH_ACTIONS,
  eloActionDenial,
  eloMatchActions,
  type EloMatchAction,
  type EloMatchFacts,
  type EloViewer,
} from "./permissions";
import type { EloMatchStatus, EloRole } from "./types";

// a1 created the match and plays on A with a2; b1 plays on B. "sb" is a referee playing on B,
// "sa" an admin playing on A (used in the staff-plays-along variants).
const facts = (patch: Partial<EloMatchFacts> = {}): EloMatchFacts => ({
  status: "DRAFT",
  createdById: "a1",
  resultPolicy: "DUAL_TEAM_CONFIRMATION",
  participants: [
    { userId: "a1", side: "A" },
    { userId: "a2", side: "A" },
    { userId: "b1", side: "B" },
  ],
  consentA: true,
  consentB: false,
  paused: false,
  submittedSide: null,
  expired: false,
  ...patch,
});
const withStaffPlaying = (patch: Partial<EloMatchFacts> = {}) =>
  facts({
    participants: [
      { userId: "a1", side: "A" },
      { userId: "sa", side: "A" },
      { userId: "b1", side: "B" },
      { userId: "sb", side: "B" },
    ],
    ...patch,
  });

const v = (userId: string, role: EloRole = "PLAYER"): EloViewer => ({ userId, role });
const A1 = v("a1");
const A2 = v("a2");
const B1 = v("b1");
const OUT = v("out");
const REF = v("ref", "REFEREE");
const ADM = v("adm", "ADMIN");
const SB = v("sb", "REFEREE");
const SA = v("sa", "ADMIN");

const result = (action: EloMatchAction, m: EloMatchFacts, viewer: EloViewer | null) =>
  eloActionDenial(action, m, viewer)?.code ?? "OK";

describe("drafts and consent", () => {
  const m = facts();

  it("lets each side confirm only its own roster", () => {
    expect(result("consent", m, B1)).toBe("OK");
    expect(result("consent", m, A2)).toBe("INVALID_STATE"); // A already consented (creator's side)
    expect(result("consent", m, OUT)).toBe("FORBIDDEN");
    expect(result("consent", m, REF)).toBe("FORBIDDEN");
  });

  it("lets non-participating staff record in-person consent, but not in their own match", () => {
    expect(result("staffConsent", m, REF)).toBe("OK");
    expect(result("staffConsent", m, ADM)).toBe("OK");
    expect(result("staffConsent", m, B1)).toBe("FORBIDDEN");
    const own = eloActionDenial("staffConsent", withStaffPlaying(), SB);
    expect(own?.code).toBe("FORBIDDEN");
    expect(own?.message).toMatch(/mitspielst/);
    expect(result("staffConsent", facts({ consentB: true }), REF)).toBe("INVALID_STATE");
  });

  it("lets the creator or staff edit and cancel, and every participant leave", () => {
    expect(result("editRoster", m, A1)).toBe("OK");
    expect(result("editRoster", m, REF)).toBe("OK");
    expect(result("editRoster", m, A2)).toBe("FORBIDDEN");
    expect(result("editRoster", m, OUT)).toBe("FORBIDDEN");
    expect(result("cancel", m, A1)).toBe("OK");
    expect(result("cancel", m, ADM)).toBe("OK");
    expect(result("cancel", m, B1)).toBe("FORBIDDEN");
    expect(result("leave", m, A2)).toBe("OK");
    expect(result("leave", m, B1)).toBe("OK");
    expect(result("leave", m, OUT)).toBe("FORBIDDEN");
  });

  it("starts only after both sides confirmed, by a participant or non-participating staff", () => {
    expect(result("start", m, A1)).toBe("INVALID_STATE");
    const ready = facts({ consentB: true });
    expect(result("start", ready, A1)).toBe("OK");
    expect(result("start", ready, B1)).toBe("OK");
    expect(result("start", ready, REF)).toBe("OK");
    expect(result("start", ready, OUT)).toBe("FORBIDDEN");
  });

  it("locks every draft action once the reservation expired", () => {
    const expired = facts({ consentB: true, expired: true });
    for (const action of ["editRoster", "consent", "staffConsent", "leave", "cancel", "start"] as const) {
      const d = eloActionDenial(action, expired, action === "staffConsent" ? REF : A1);
      expect(d?.code).toBe("INVALID_STATE");
      expect(d?.message).toMatch(/abgelaufen/);
    }
  });
});

describe("running matches", () => {
  const m = facts({ status: "IN_PROGRESS", consentB: true });

  it("lets participants and non-participating staff work the clock", () => {
    expect(result("pause", m, A2)).toBe("OK");
    expect(result("pause", m, REF)).toBe("OK");
    expect(result("pause", m, OUT)).toBe("FORBIDDEN");
    expect(result("resume", m, A2)).toBe("INVALID_STATE");
    const paused = facts({ status: "IN_PROGRESS", consentB: true, paused: true });
    expect(result("pause", paused, B1)).toBe("INVALID_STATE");
    expect(result("resume", paused, B1)).toBe("OK");
  });

  it("lets participants submit and staff decide, never staff in their own match (admins included)", () => {
    expect(result("submitResult", m, A1)).toBe("OK");
    expect(result("submitResult", m, B1)).toBe("OK");
    expect(eloActionDenial("submitResult", m, REF)?.message).toMatch(/Resultat festlegen/);
    expect(result("submitResult", m, OUT)).toBe("FORBIDDEN");
    expect(result("staffFinalize", m, REF)).toBe("OK");
    expect(result("staffFinalize", m, ADM)).toBe("OK");
    expect(result("staffFinalize", m, A1)).toBe("FORBIDDEN");
    const own = withStaffPlaying({ status: "IN_PROGRESS", consentB: true });
    expect(result("staffFinalize", own, SB)).toBe("FORBIDDEN");
    expect(result("staffFinalize", own, SA)).toBe("FORBIDDEN");
    expect(result("abandon", own, SA)).toBe("FORBIDDEN");
    expect(result("abandon", m, REF)).toBe("OK");
    // Playing staff act as ordinary participants.
    expect(result("submitResult", own, SA)).toBe("OK");
  });
});

describe("pending results (show and confirm)", () => {
  const m = facts({ status: "AWAITING_CONFIRMATION", consentB: true, submittedSide: "A" });

  it("lets only the submitting side amend and only the other side confirm or dispute", () => {
    expect(result("amendResult", m, A2)).toBe("OK");
    expect(result("amendResult", m, B1)).toBe("FORBIDDEN");
    expect(result("confirmResult", m, B1)).toBe("OK");
    expect(result("confirmResult", m, A1)).toBe("FORBIDDEN");
    expect(result("confirmResult", m, OUT)).toBe("FORBIDDEN");
    expect(result("confirmResult", m, REF)).toBe("FORBIDDEN"); // staff use staffFinalize
    expect(result("disputeResult", m, B1)).toBe("OK");
    expect(result("disputeResult", m, A2)).toBe("FORBIDDEN");
    expect(result("staffFinalize", m, REF)).toBe("OK");
    expect(result("voidResult", m, ADM)).toBe("OK");
    expect(result("voidResult", m, B1)).toBe("FORBIDDEN");
  });

  it("leaves confirmation to the referees under REFEREE_ONLY", () => {
    const r = facts({ ...m, resultPolicy: "REFEREE_ONLY" });
    expect(eloActionDenial("confirmResult", r, B1)?.message).toMatch(/Schiri/);
    expect(result("disputeResult", r, B1)).toBe("OK");
    expect(result("staffFinalize", r, REF)).toBe("OK");
  });

  it("never lets one person both report and confirm a result", () => {
    for (const viewer of [A1, A2, B1]) {
      const flags = eloMatchActions(m, viewer);
      expect(flags.amendResult && flags.confirmResult).toBe(false);
    }
  });
});

describe("disputes, completed and closed matches", () => {
  it("leaves disputes to non-participating staff", () => {
    const d = facts({ status: "DISPUTED", consentB: true, submittedSide: "A" });
    expect(result("staffFinalize", d, REF)).toBe("OK");
    expect(result("voidResult", d, REF)).toBe("OK");
    expect(result("staffFinalize", d, B1)).toBe("FORBIDDEN");
    expect(result("confirmResult", d, B1)).toBe("INVALID_STATE");
  });

  it("lets only admins correct or void completed matches, also their own (audited by the service)", () => {
    const c = withStaffPlaying({ status: "COMPLETED", consentB: true });
    expect(result("correct", c, ADM)).toBe("OK");
    expect(result("correct", c, SA)).toBe("OK");
    expect(result("voidCompleted", c, ADM)).toBe("OK");
    expect(result("correct", c, REF)).toBe("FORBIDDEN");
    expect(result("correct", c, A1)).toBe("FORBIDDEN");
  });

  it("allows nothing on cancelled or voided matches and nothing without a session", () => {
    for (const status of ["CANCELLED", "VOIDED"] as EloMatchStatus[]) {
      for (const viewer of [A1, B1, REF, ADM]) {
        expect(Object.values(eloMatchActions(facts({ status }), viewer)).some(Boolean)).toBe(false);
      }
    }
    for (const action of ELO_MATCH_ACTIONS) expect(result(action, facts(), null)).toBe("UNAUTHENTICATED");
  });
});

describe("matrix invariants", () => {
  const statuses: EloMatchStatus[] = [
    "DRAFT",
    "IN_PROGRESS",
    "AWAITING_CONFIRMATION",
    "DISPUTED",
    "COMPLETED",
    "CANCELLED",
    "VOIDED",
  ];
  const variants = statuses.flatMap((status) =>
    [false, true].flatMap((paused) =>
      (["A", "B"] as const).map((submittedSide) =>
        withStaffPlaying({ status, paused, submittedSide, consentB: true }),
      ),
    ),
  );

  it("never grants staff powers to someone who plays in the match", () => {
    for (const m of variants) {
      for (const viewer of [SA, SB, A1, B1]) {
        const flags = eloMatchActions(m, viewer);
        expect(flags.staffConsent || flags.staffFinalize || flags.voidResult || flags.abandon).toBe(false);
      }
    }
  });

  it("keeps the flags, the denials and assertEloAction consistent", () => {
    for (const m of variants) {
      for (const viewer of [A1, B1, SA, SB, OUT, REF, ADM]) {
        const flags = eloMatchActions(m, viewer);
        for (const action of ELO_MATCH_ACTIONS) {
          const denial = eloActionDenial(action, m, viewer);
          expect(flags[action]).toBe(denial === null);
          if (denial) expect(() => assertEloAction(action, m, viewer)).toThrow(denial.message);
          else expect(() => assertEloAction(action, m, viewer)).not.toThrow();
        }
      }
    }
  });

  it("writes Swiss German messages", () => {
    for (const m of variants) {
      for (const action of ELO_MATCH_ACTIONS) {
        expect(eloActionDenial(action, m, OUT)?.message ?? "").not.toMatch(/ß/);
      }
    }
  });
});
