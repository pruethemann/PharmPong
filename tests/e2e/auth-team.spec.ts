import { expect, test, type Browser, type Page } from "@playwright/test";
import { uniqueEmail } from "./support/auth";
import { clearThrottles, scenario } from "./support/db";
import { BASE_URL, storageStateFor } from "./support/env";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  scenario("registration");
  await clearThrottles();
});

async function register(page: Page, name: string, email: string) {
  await page.getByLabel("Anzeigename").fill(name);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("ein langes Testpasswort 42");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
}

async function newPhoneLikeContext(browser: Browser, page: Page) {
  // Same device settings as the current project, but no session.
  const viewport = page.viewportSize() ?? undefined;
  return browser.newContext({ baseURL: BASE_URL, viewport, locale: "de-CH", timezoneId: "Europe/Zurich" });
}

test("register, found a team and let a partner join via the invite link", async ({
  page,
  context,
  browser,
}) => {
  const run = Date.now().toString(36).slice(-5);
  const teamName = `E2E Laborratten ${run}`;
  const founder = `Gründerin ${run}`;
  const partner = `Partner ${run}`;

  await page.goto("/register");
  await register(page, founder, uniqueEmail("founder"));
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole("heading", { name: "Mein Team" })).toBeVisible();

  await page.getByLabel("Teamname").fill(teamName);
  await page.getByLabel("Motto (optional)").fill("Präzise bis zum letzten Becher");
  await page.getByRole("button", { name: "Team gründen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Partner:in einladen" })).toBeVisible();
  await expect(page.getByText("Wartet auf Partner:in")).toBeVisible();

  // Copy the invite link with the UI button and read it back from the clipboard.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  await page.getByRole("button", { name: "Link kopieren" }).click();
  await expect(page.getByText("Link kopiert")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const code = /\/join\/([A-Z0-9]+)$/i.exec(link)?.[1];
  expect(code, `invite link from clipboard: ${link}`).toBeTruthy();
  await expect(page.getByText(link, { exact: true })).toBeVisible();

  // Second person, own browser context: open the link, register, join.
  const other = await newPhoneLikeContext(browser, page);
  try {
    const p2 = await other.newPage();
    await p2.goto(`/join/${code}`);
    await expect(p2.getByText(teamName)).toBeVisible();
    await expect(p2.getByText("1/2 Spieler:innen")).toBeVisible();
    await p2.getByRole("link", { name: "Konto erstellen und beitreten" }).click();
    await expect(p2).toHaveURL(/\/register\?next=/);
    await register(p2, partner, uniqueEmail("partner"));
    await expect(p2).toHaveURL(new RegExp(`/join/${code}$`));
    await p2.getByRole("button", { name: "Team beitreten" }).click();
    await expect(p2).toHaveURL(/\/team$/);
    await expect(p2.getByRole("heading", { level: 1, name: teamName })).toBeVisible();
    await expect(p2.getByText("Vollständig", { exact: true })).toBeVisible();
    const members2 = p2.getByRole("list", { name: "Mitglieder" });
    await expect(members2.getByText(founder)).toBeVisible();
    await expect(members2.getByText(partner)).toBeVisible();
  } finally {
    await other.close();
  }

  await page.reload();
  await expect(page.getByText("Vollständig", { exact: true })).toBeVisible();
  const members = page.getByRole("list", { name: "Mitglieder" });
  await expect(members.getByRole("listitem")).toHaveCount(2);
  await expect(members.getByText(partner)).toBeVisible();
  await expect(page.getByText("Freier Platz für deine:n Partner:in")).toHaveCount(0);
});

test("invalid login shows the German error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(uniqueEmail("nobody"));
  await page.getByLabel("Passwort", { exact: true }).fill("falsches-passwort-123");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("E-Mail oder Passwort ist falsch.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("protected routes redirect guests to /login", async ({ page }) => {
  for (const path of ["/team", "/referee", "/admin", "/admin/matches", "/profile"]) {
    await page.goto(path);
    await expect(page, `guest on ${path}`).toHaveURL(
      new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[/]/g, "%2F")}$`),
    );
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  }
});

test.describe("as player", () => {
  test.use({ storageState: storageStateFor("player") });

  test("player is turned away from /admin and /referee", async ({ page }) => {
    for (const path of ["/admin", "/admin/tournament", "/referee"]) {
      await page.goto(path);
      await expect(page, `player on ${path}`).toHaveURL(/\/\?forbidden=1$/);
    }
    // Admin controls are not rendered for players.
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Schiri" })).toHaveCount(0);
  });
});
