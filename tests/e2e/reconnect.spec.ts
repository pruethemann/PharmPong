// Network loss on live pages: the badge must say so and critical writes must be locked.
import { expect, test, type Page } from "@playwright/test";
import { scenario } from "./support/db";
import { storageStateFor } from "./support/env";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(120_000);
  scenario("groups");
});

const LIVE_API = /\/api\/live(\/|\?|$)/;
const reconnecting = (page: Page) =>
  page.getByRole("status").filter({ hasText: /Verbinde neu|Offline: keine Verbindung/ });
const offline = (page: Page) => page.getByRole("status").filter({ hasText: "Offline: keine Verbindung" });
const liveBadge = (page: Page) => page.getByText("Live", { exact: true }).filter({ visible: true });

test.describe("referee", () => {
  test.use({ storageState: storageStateFor("referee") });

  test("blocked live API → badge reconnecting/offline, buttons locked; unblocked → Live again", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/referee");
    await page
      .getByRole("group", { name: "Tisch wählen" })
      .getByRole("button", { name: /^Tisch 1\b/ })
      .click();
    const panel = page.getByRole("region", { name: "Aktueller Tisch" });
    const enter = panel.getByRole("button", { name: "Resultat erfassen" });
    const pause = panel.getByRole("button", { name: "Uhr pausieren" });
    await expect(liveBadge(page)).toBeVisible();
    await expect(enter).toBeEnabled();
    await expect(pause).toBeEnabled();

    await page.route(LIVE_API, (route) => route.abort("internetdisconnected"));
    await expect(reconnecting(page)).toBeVisible({ timeout: 10_000 });
    await expect(enter).toBeDisabled();
    await expect(pause).toBeDisabled();
    await expect(offline(page)).toBeVisible({ timeout: 20_000 });
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Offline|Verbindung/ })
        .first(),
    ).toBeVisible();
    await expect(panel.getByText(/Offline: Aktionen sind gesperrt/)).toBeVisible();

    await page.unroute(LIVE_API);
    await expect(liveBadge(page)).toBeVisible({ timeout: 25_000 });
    await expect(reconnecting(page)).toHaveCount(0);
    await expect(enter).toBeEnabled({ timeout: 10_000 });
    await expect(pause).toBeEnabled();
  });
});

test.describe("player", () => {
  test.use({ storageState: storageStateFor("player") });

  test("tournament page shows the connection state", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/tournament");
    await expect(liveBadge(page)).toBeVisible();
    await page.route(LIVE_API, (route) => route.abort("internetdisconnected"));
    await expect(reconnecting(page)).toBeVisible({ timeout: 10_000 });
    await expect(offline(page)).toBeVisible({ timeout: 20_000 });
    await page.unroute(LIVE_API);
    await expect(liveBadge(page)).toBeVisible({ timeout: 25_000 });
  });
});
