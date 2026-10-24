// Referee happy path on the "groups" scenario: Tisch 1 is running, Tisch 2 awaits confirmation.
// A second browser context (player on /tournament) must see every step without reloading.
import { expect, test, type Page } from "@playwright/test";
import { scenario } from "./support/db";
import { BASE_URL, storageStateFor } from "./support/env";
import { activeTabPanel, holdToConfirm } from "./support/ui";

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("referee") });

test.beforeAll(() => {
  test.setTimeout(120_000);
  scenario("groups");
});

const LIVE_UPDATE = { timeout: 6_000 };

function statusCount(observer: Page, label: string) {
  return activeTabPanel(observer).getByText(label, { exact: true });
}

test("referee runs a match end to end; the player dashboard follows live", async ({ page, browser }) => {
  test.setTimeout(120_000);

  const observerCtx = await browser.newContext({
    baseURL: BASE_URL,
    storageState: storageStateFor("player"),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  });
  const observer = await observerCtx.newPage();
  await observer.goto("/tournament?tab=spielplan");
  await expect(statusCount(observer, "Beendet")).toHaveCount(6);
  await expect(statusCount(observer, "Wartet auf Bestätigung")).toHaveCount(1);
  await expect(statusCount(observer, "Läuft")).toHaveCount(1);

  await page.goto("/referee");
  const pickTable2 = page
    .getByRole("group", { name: "Tisch wählen" })
    .getByRole("button", { name: /^Tisch 2\b/ });
  await pickTable2.click();
  await expect(pickTable2).toHaveAttribute("aria-pressed", "true");

  // 1) Tisch 2 still has an unconfirmed proposal from the scenario: confirm it to free the table.
  const panel = page.getByRole("region", { name: "Aktueller Tisch" });
  await expect(panel.getByText("Kontrolle · Schritt 2 von 2")).toBeVisible();
  await holdToConfirm(page, panel.getByRole("button", { name: "Gedrückt halten zum Bestätigen" }));
  await expect(panel.getByRole("heading", { name: "Resultat gespeichert" })).toBeVisible();
  await expect(statusCount(observer, "Wartet auf Bestätigung")).toHaveCount(0, LIVE_UPDATE);
  await expect(statusCount(observer, "Beendet")).toHaveCount(7, LIVE_UPDATE);

  // 2) Next match: take the scheduler's suggestion onto Tisch 2 and start it.
  await panel.getByRole("button", { name: /Nächstes Spiel/ }).click();
  await expect(panel.getByText("Nächstes Spiel", { exact: true })).toBeVisible();
  const matchLabel = (await panel.getByRole("heading", { level: 2 }).first().innerText()).trim();
  await panel.getByRole("button", { name: "Auf Tisch 2 holen" }).click();
  await expect(panel.getByText("Bereit am Tisch")).toBeVisible();
  await panel.getByRole("button", { name: "Spiel starten" }).click();
  await expect(statusCount(observer, "Läuft")).toHaveCount(2, LIVE_UPDATE);

  // 3) The countdown is visible and ticking.
  const timer = panel.getByRole("timer");
  await expect(timer).toBeVisible();
  const before = await timer.getAttribute("aria-label");
  expect(before).toMatch(/^Restzeit \d+:\d{2}$/);
  await expect.poll(() => timer.getAttribute("aria-label"), { timeout: 5_000 }).not.toBe(before);

  // 4) Enter the result: all cups hit, Team A wins with 7 cups left.
  await panel.getByRole("button", { name: "Resultat erfassen" }).click();
  await expect(panel.getByText("Resultat erfassen · Schritt 1 von 2")).toBeVisible();
  await panel
    .getByRole("group", { name: "Art des Spielendes" })
    .getByRole("button", { name: /Alle Becher getroffen/ })
    .click();
  const minus = panel.getByRole("button", { name: /^Ein Becher weniger bei/ });
  for (let i = 0; i < 3; i++) await minus.first().click();
  await panel.getByRole("button", { name: "Alle getroffen: auf 0 setzen" }).nth(1).click();
  const winnerGroup = panel.getByRole("group", { name: /Wer hat gewonnen/ });
  const homeCard = winnerGroup.getByRole("button").first();
  await homeCard.click();
  await expect(homeCard).toHaveAttribute("aria-pressed", "true");
  await expect(homeCard).toContainText("Sieger");
  const winnerName = (await homeCard.locator("span").nth(1).innerText()).trim();
  const winnerDone = () =>
    activeTabPanel(observer).getByRole("link").filter({ hasText: winnerName }).filter({ hasText: "Beendet" });
  const winnerDoneBefore = await winnerDone().count();
  await panel.getByRole("button", { name: "Weiter zur Kontrolle" }).click();

  // 5) Review shows what the server stored.
  await expect(panel.getByText("Kontrolle · Schritt 2 von 2")).toBeVisible();
  await expect(panel.getByText(`${winnerName} gewinnt`)).toBeVisible();
  await expect(panel.getByText("Alle Becher getroffen", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Erfasst von dir um \d{2}:\d{2} Uhr/)).toBeVisible();
  await expect(statusCount(observer, "Wartet auf Bestätigung")).toHaveCount(1, LIVE_UPDATE);

  // 6) Hold to confirm → server-confirmed success state.
  await holdToConfirm(page, panel.getByRole("button", { name: "Gedrückt halten zum Bestätigen" }));
  await expect(panel.getByRole("heading", { name: "Resultat gespeichert" })).toBeVisible();
  await expect(page.getByText(matchLabel).first()).toBeVisible();

  // 7) The player's dashboard follows without reload.
  await expect(statusCount(observer, "Beendet")).toHaveCount(8, LIVE_UPDATE);
  await expect(statusCount(observer, "Wartet auf Bestätigung")).toHaveCount(0, LIVE_UPDATE);
  await expect(statusCount(observer, "Läuft")).toHaveCount(1, LIVE_UPDATE);
  await expect(winnerDone()).toHaveCount(winnerDoneBefore + 1, LIVE_UPDATE);

  await observerCtx.close();
});
