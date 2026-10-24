// Admin corrects a quarterfinal whose semifinal already started → recovery wizard.
// Desktop only (admin console; the phone flow is the same components).
import { expect, test, type APIRequestContext } from "@playwright/test";
import { scenario, tsx } from "./support/db";
import { storageStateFor } from "./support/env";

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

type Snap = {
  teams: { id: string; name: string }[];
  matches: {
    id: string;
    code: string;
    label: string;
    status: string;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeSource: string | null;
    awaySource: string | null;
    result: { winnerTeamId: string } | null;
  }[];
};

async function snapshot(request: APIRequestContext): Promise<Snap> {
  const res = await request.get("/api/live");
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe("recovery @desktop-only", () => {
  test.beforeAll(() => {
    test.setTimeout(150_000);
    scenario("knockout");
    tsx("start-semifinal.ts"); // SF1 is now IN_PROGRESS
  });

  test("correcting a QF after its SF started goes through the recovery wizard", async ({ page }) => {
    test.setTimeout(90_000);
    const before = await snapshot(page.request);
    const name = (id: string | null) => before.teams.find((t) => t.id === id)?.name ?? "?";
    const sf1 = before.matches.find((m) => m.code === "SF1")!;
    expect(sf1.status).toBe("IN_PROGRESS");
    const qfCode = sf1.homeSource!.replace(/^W:/, "");
    const qf = before.matches.find((m) => m.code === qfCode)!;
    expect(qf.status).toBe("COMPLETED");
    const oldWinner = qf.result!.winnerTeamId;
    const newWinner = oldWinner === qf.homeTeamId ? qf.awayTeamId! : qf.homeTeamId!;
    const newWinnerIsHome = newWinner === qf.homeTeamId;
    expect(sf1.homeTeamId).toBe(oldWinner);

    await page.goto("/admin/matches");
    await page.getByRole("button", { name: `${qfCode} öffnen` }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: qfCode, exact: true })).toBeVisible();
    // With a single possible action the sheet shows the correction form directly.
    const chooser = sheet.getByRole("group", { name: "Aktion wählen" });
    if (await chooser.isVisible()) await chooser.getByRole("button", { name: "Korrigieren" }).click();
    await expect(sheet.getByRole("button", { name: "Korrektur speichern" })).toBeVisible();

    // The radio is visually hidden; users tap its card (the <label>).
    await sheet
      .locator("label")
      .filter({ hasText: name(newWinner) })
      .click();
    await expect(sheet.getByRole("radio", { name: name(newWinner) })).toBeChecked();
    await sheet.getByLabel("Art des Spielendes").selectOption("REGULAR");
    await sheet.getByLabel("Becher übrig Team A").selectOption(newWinnerIsHome ? "3" : "0");
    await sheet.getByLabel("Becher übrig Team B").selectOption(newWinnerIsHome ? "0" : "3");
    await sheet.getByLabel("Begründung (fürs Audit-Log)").fill("E2E: Sieger falsch erfasst");
    await sheet.getByRole("button", { name: "Korrektur speichern" }).click();

    // Wizard step 1: impact plan lists the running semifinal.
    // (its title changes on the last step, the step list stays)
    const wizard = page.getByRole("dialog").filter({ has: page.getByRole("list", { name: "Schritte" }) });
    await expect(wizard).toHaveAccessibleName(`Wiederherstellung ${qfCode}`);
    await expect(wizard.getByText("Folgespiele haben bereits begonnen.", { exact: false })).toBeVisible();
    await expect(wizard.getByText(/Spiele? wird zurückgesetzt|Spiele werden zurückgesetzt/)).toBeVisible();
    await expect(wizard.getByText("SF1", { exact: true })).toBeVisible();
    await expect(wizard.getByText(/Laufendes Spiel an Tisch \d wird abgebrochen/)).toBeVisible();
    await wizard.getByRole("button", { name: "Weiter zur Bestätigung" }).click();

    // Step 2: typed confirmation.
    const go = wizard.getByRole("button", { name: "Zurücksetzen & korrigieren" });
    await wizard.getByLabel("Begründung (fürs Audit-Log)").fill("E2E: Sieger falsch erfasst");
    await expect(go).toBeDisabled();
    await wizard.getByLabel(`Zur Bestätigung «${qfCode} ZURÜCKSETZEN» eintippen`).fill("falsch");
    await expect(go).toBeDisabled();
    await wizard
      .getByLabel(`Zur Bestätigung «${qfCode} ZURÜCKSETZEN» eintippen`)
      .fill(`${qfCode} ZURÜCKSETZEN`);
    await go.click();

    // Step 3: done.
    await expect(wizard).toHaveAccessibleName("Wiederherstellung abgeschlossen");
    const done = wizard.getByRole("status");
    await expect(done.getByText(`Resultat von ${qfCode} korrigiert.`)).toBeVisible();
    await expect(done.getByRole("definition").first()).toContainText("SF1");
    await wizard.getByRole("button", { name: "Fertig" }).click();

    // Data is consistent: QF winner changed, SF1 reset (not running) with the new winner seeded.
    await expect
      .poll(async () => {
        const s = await snapshot(page.request);
        const q = s.matches.find((m) => m.code === qfCode)!;
        const sf = s.matches.find((m) => m.code === "SF1")!;
        return [q.status, q.result?.winnerTeamId, sf.homeTeamId, sf.status === "IN_PROGRESS"];
      })
      .toEqual(["COMPLETED", newWinner, newWinner, false]);

    // And the bracket shows it.
    await page.goto("/tournament?tab=ko");
    const bracket = page.getByRole("region", { name: "K.-o.-Tableau" });
    const sfNode = bracket.getByRole("link", { name: new RegExp(`^${escape(sf1.label)}:`) });
    await expect(sfNode).toBeVisible();
    // Home slot (fed by the corrected QF) now holds the new winner.
    await expect(sfNode).toHaveAccessibleName(new RegExp(`${escape(name(newWinner))}.* gegen `));
    await expect(sfNode).not.toHaveAccessibleName(new RegExp(`${escape(name(oldWinner))}.* gegen `));
  });
});

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
