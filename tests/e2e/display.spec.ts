// Public projector view (/display): read-only, no login, never any private data.
// Desktop only: the display is built for a 16:9 screen.
import { expect, test, type Page } from "@playwright/test";
import { scenario } from "./support/db";
import { BASE_URL, storageStateFor } from "./support/env";

test.describe.configure({ mode: "serial" });

const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

async function expectNoPrivateData(page: Page) {
  // Visible text: not a single "@".
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("@");
  // Whole HTML incl. the inline RSC payload: no e-mail address, no demo domain. (A bare "@" does
  // occur in framework internals: React's "$@" promise references and an inline @media rule.)
  const html = await page.content();
  expect(html).not.toMatch(EMAIL);
  expect(html).not.toContain("pharmapong.test");
  expect(html).not.toMatch(/inviteCode|passwordHash/);
}

test.describe("group stage @desktop-only", () => {
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("groups");
  });

  test("shows both tables to logged-out visitors without private data", async ({ page, request }) => {
    await page.goto("/display");
    const tables = page.getByRole("region", { name: "Tische" });
    await expect(tables.getByRole("article", { name: "Tisch 1" })).toBeVisible();
    await expect(tables.getByRole("article", { name: "Tisch 2" })).toBeVisible();
    await expect(page.getByRole("timer").first()).toBeVisible();
    // Read-only: no forms or admin controls.
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /admin/i })).toHaveCount(0);
    await expectNoPrivateData(page);

    const res = await request.get("/api/live/public");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("@");
    const json = JSON.parse(body);
    expect(json.tables).toHaveLength(2);
    expect(json.teams.length).toBe(12);
  });

  test("admin disables the public display → disabled screen and 404 API", async ({ page, browser }) => {
    const admin = await browser.newContext({
      baseURL: BASE_URL,
      storageState: storageStateFor("admin"),
      viewport: { width: 1280, height: 800 },
    });
    const adminPage = await admin.newPage();
    const setPublic = async (on: boolean) => {
      await adminPage.goto("/admin/tournament");
      const sw = adminPage.getByRole("switch", { name: "Öffentliche Anzeige" });
      await expect(sw).toHaveAttribute("aria-checked", on ? "false" : "true");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", on ? "true" : "false");
      await adminPage.getByRole("button", { name: "Einstellungen speichern" }).click();
      await expect(adminPage.getByText("Einstellungen gespeichert.")).toBeVisible();
    };

    try {
      await setPublic(false);

      await page.goto("/display");
      await expect(page.getByRole("heading", { name: "Anzeige ist deaktiviert" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Tische" })).toHaveCount(0);
      const res = await page.request.get("/api/live/public");
      expect(res.status()).toBe(404);

      await setPublic(true);
      const again = await page.request.get("/api/live/public");
      expect(again.status()).toBe(200);
    } finally {
      await admin.close();
    }
  });
});

test.describe("completed tournament @desktop-only", () => {
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("completed");
  });

  async function championName(page: Page): Promise<string> {
    const json = await (await page.request.get("/api/live/public")).json();
    const id = json.tournament.championTeamId as string;
    expect(json.tournament.status).toBe("COMPLETED");
    return json.teams.find((t: { id: string }) => t.id === id).name;
  }

  test("champion takeover", async ({ page }) => {
    await page.goto("/display");
    const name = await championName(page);
    const takeover = page.getByRole("region", { name: "Turniersieger" });
    await expect(takeover).toBeVisible();
    await expect(takeover.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(takeover.getByText(/PharmaPong Champion \d{4}/)).toBeVisible();
    await expectNoPrivateData(page);
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("champion takeover still shows, without the bubbling animation", async ({ page }) => {
      await page.goto("/display");
      const name = await championName(page);
      const takeover = page.getByRole("region", { name: "Turniersieger" });
      await expect(takeover.getByRole("heading", { level: 1, name })).toBeVisible();
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      // The bubbles container is motion-reduce:hidden.
      const bubbles = takeover.locator(".motion-reduce\\:hidden");
      await expect(bubbles).toHaveCount(1);
      await expect(bubbles).toBeHidden();
    });
  });
});
