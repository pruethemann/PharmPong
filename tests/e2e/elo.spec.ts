// Elo Mode end to end. `pnpm scenario elo` = after the final: 24 confirmed Elo matches, a running
// match on Tisch 1, a draft on Tisch 2 that waits for demo01, a result that waits for demo02 and a
// dispute. Several browser contexts play the different people; nothing is reloaded by hand where
// the app should follow live.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { axeScan, checkPhoneLayout } from "./support/checks";
import { clearThrottles, scenario } from "./support/db";
import { BASE_URL, storageStateFor, type Role } from "./support/env";

const LIVE = { timeout: 15_000 };
const MODE_FOLLOW = { timeout: 25_000 }; // ModeWatch polls every 10 s

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL, locale: "de-CH", timezoneId: "Europe/Zurich" });
  const page = await ctx.newPage();
  await loginViaUi(page, email);
  return page;
}

async function asRole(browser: Browser, role: Role): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    storageState: storageStateFor(role),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  });
  return ctx.newPage();
}

function toast(page: Page, text: string | RegExp) {
  return expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible(LIVE);
}

test.describe("Elo Mode: a match between two players @desktop-only", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    scenario("elo");
    await clearThrottles();
  });

  test("build, consent on the other phone, play, report, confirm", async ({ browser }) => {
    test.setTimeout(150_000);
    // The draft's creator frees Tisch 2.
    const creator = await signedIn(browser, "demo17@pharmapong.test");
    await creator.getByRole("link", { name: /Dein Match/ }).click();
    await creator.getByRole("button", { name: "Match abbrechen" }).click();
    await creator.getByRole("dialog").getByRole("button", { name: "Match abbrechen" }).click();
    await creator.waitForURL(`${BASE_URL}/`);

    // demo03 builds a match against demo05 (Lina J.) on Tisch 2.
    const a = await signedIn(browser, "demo03@pharmapong.test");
    await a.goto("/elo/play?table=2");
    await expect(a.getByRole("heading", { name: "Wer spielt?" })).toBeVisible();
    await a
      .getByRole("region", { name: "Team B" })
      .getByRole("button", { name: "Spieler:innen wählen" })
      .click();
    const sheet = a.getByRole("dialog");
    await sheet.getByRole("searchbox", { name: "Name suchen" }).fill("lina");
    await sheet.getByRole("button", { name: /Lina J\./ }).click();
    await sheet.getByRole("button", { name: "Fertig" }).click();
    await a.getByRole("button", { name: "Weiter zur Vorschau" }).click();
    await expect(a.getByRole("img", { name: /^Siegchance: Team A \d+ %, Team B \d+ %$/ })).toBeVisible();
    await a.getByRole("button", { name: "Match erstellen" }).click();
    await a.waitForURL(/\/elo\/matches\//);
    const matchUrl = a.url();
    await expect(a.getByText("wartet", { exact: true })).toBeVisible();

    // demo05 sees the invitation and agrees on their own phone.
    const b = await signedIn(browser, "demo05@pharmapong.test");
    await expect(b.getByRole("link", { name: /Dein Match/ })).toBeVisible();
    await b.goto(matchUrl);
    await b.getByRole("button", { name: "Ja, wir spielen mit" }).click();

    // demo03's page follows: start, pause, resume, end.
    await a.getByRole("button", { name: "Spiel starten" }).click(LIVE);
    await expect(a.getByRole("timer")).toBeVisible();
    await a.getByRole("button", { name: "Pause" }).click();
    await expect(a.getByRole("timer")).toHaveAccessibleName(/pausiert/);
    await a.getByRole("button", { name: "Weiterspielen" }).click();
    await expect(a.getByRole("button", { name: "Pause" })).toBeVisible();
    await a.getByRole("button", { name: "Match beenden" }).click();
    await a.getByRole("button", { name: /^Team A\b/ }).click();
    await expect(a.getByRole("heading", { name: "Stimmt das so?" })).toBeVisible();
    await a.getByRole("button", { name: "Resultat eintragen" }).click();
    await expect(a.getByText(/Wartet auf die Bestätigung durch Team B/)).toBeVisible();

    // demo05 sees the report without reloading and confirms; both see the outcome.
    await b.getByRole("button", { name: "Ja, bestätigen" }).click(LIVE);
    await expect(b.getByText("Knapp daneben")).toBeVisible(LIVE);
    await expect(a.getByText("Gewonnen!")).toBeVisible(LIVE);
    await expect(a.getByRole("table", { name: /Elo vor und nach dem Match/ })).toBeVisible();

    await a.goto("/elo/rankings");
    await expect(a.getByRole("table", { name: "Elo-Rangliste dieser Runde" })).toContainText("(du)");
  });
});

test.describe("Elo Mode: referee and administration @desktop-only", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    scenario("elo");
    await clearThrottles();
  });

  test("the referee resolves the dispute and abandons the running match", async ({ browser }) => {
    const schiri = await asRole(browser, "referee");
    await schiri.goto("/referee"); // redirects to the Elo board in Elo Mode
    await schiri.waitForURL(/\/elo\/referee$/);
    await schiri
      .getByRole("link", { name: /Einspruch/ })
      .first()
      .click();
    await schiri.getByRole("button", { name: "Einspruch entscheiden" }).click();
    await schiri.getByRole("button", { name: /^Team B\b/ }).click();
    await schiri.getByLabel(/Begründung/).fill("Beide Teams befragt");
    await schiri.getByRole("button", { name: "Resultat festlegen" }).click();
    await expect(schiri.getByText("Team B gewinnt").first()).toBeVisible(LIVE);

    await schiri.goto("/elo/referee");
    await schiri.getByRole("link", { name: /Läuft/ }).first().click();
    await schiri.getByRole("button", { name: "Match abbrechen" }).click();
    await schiri
      .getByRole("dialog")
      .getByLabel(/Begründung/)
      .fill("Tisch wird gebraucht");
    await schiri.getByRole("dialog").getByRole("button", { name: "Match abbrechen" }).click();
    await expect(schiri.getByText("Abgebrochen", { exact: true }).first()).toBeVisible(LIVE);
  });

  test("the admin checks, corrects, recalculates and changes the parameters", async ({ browser }) => {
    const admin = await asRole(browser, "admin");
    await admin.goto("/admin/elo");
    await admin.getByRole("button", { name: "Prüfen (ohne Änderung)" }).click();
    await expect(admin.getByText(/^Alles stimmt/)).toBeVisible();

    await admin.getByRole("button", { name: "Beendet", exact: true }).click();
    await admin.getByRole("button", { name: "Korrigieren" }).last().click();
    const dlg = admin.getByRole("dialog");
    const a = dlg.getByRole("radio", { name: "Team A" });
    if (await a.isChecked()) await dlg.getByRole("radio", { name: "Team B" }).check();
    else await a.check();
    await dlg.getByLabel(/Begründung/).fill("Sieger vertauscht");
    await dlg.getByRole("button", { name: "Korrektur speichern" }).click();
    await toast(admin, /Korrigiert\. Neue Berechnung Nr\./);
    await admin.getByRole("button", { name: "Prüfen (ohne Änderung)" }).click();
    await expect(admin.getByText(/^Alles stimmt/)).toBeVisible();

    await admin.getByLabel("Erinnerung nach Minuten").fill("25");
    await admin.getByRole("button", { name: "Einstellungen speichern" }).click();
    await toast(admin, "Einstellungen gespeichert.");

    await admin.getByText("Wertungsparameter ändern").click();
    await admin.getByLabel("K-Faktor (max. Punkte pro Team)").fill("20");
    await admin.getByRole("button", { name: "Parameter übernehmen" }).click();
    const p = admin.getByRole("dialog");
    await p.getByLabel(/Begründung/).fill("Kleinere Sprünge");
    await expect(p.getByRole("button", { name: "Ändern und neu berechnen" })).toBeDisabled();
    await p.getByLabel(/eintippen/).fill("ELO NEU BERECHNEN");
    await p.getByRole("button", { name: "Ändern und neu berechnen" }).click();
    await toast(admin, /Parameter übernommen/);
  });

  test("blocked mode switch, then close the round: the projector shows the champion", async ({ browser }) => {
    test.setTimeout(120_000);
    // demo02 confirms the pending result (otherwise it blocks the switch).
    const demo02 = await signedIn(browser, "demo02@pharmapong.test");
    await demo02.getByRole("link", { name: /Resultat bestätigen/ }).click();
    await demo02.getByRole("button", { name: "Ja, bestätigen" }).click();
    await expect(demo02.getByText(/Gewonnen!|Knapp daneben/)).toBeVisible(LIVE);

    const display = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1920, height: 1080 } });
    await display.goto("/display");
    await expect(display.getByRole("region", { name: "Rangliste" })).toBeVisible();

    const admin = await asRole(browser, "admin");
    await admin.goto("/admin/elo");
    await admin.getByRole("button", { name: "Zurück zum Turnier" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Jetzt wechseln" }).click();
    await toast(admin, /offene Match/);
    await admin.getByRole("button", { name: /Offene Aufstellung abbrechen/ }).click();
    await admin
      .getByRole("dialog")
      .getByLabel(/Begründung/)
      .fill("Runde endet");
    await admin.getByRole("dialog").getByRole("button", { name: "Abbrechen bestätigen" }).click();
    await toast(admin, /Aufstellung\(en\) abgebrochen/);

    await admin.getByRole("button", { name: "Runde beenden" }).click();
    const close = admin.getByRole("dialog");
    await expect(close.getByRole("button", { name: "Runde beenden" })).toBeDisabled();
    await close.getByLabel(/eintippen/).fill("ELO-RUNDE BEENDEN");
    await close.getByRole("button", { name: "Runde beenden" }).click();
    await toast(admin, /Runde beendet/);
    await expect(display.getByRole("region", { name: /Elo-Champion/ })).toBeVisible(LIVE);
  });
});

test.describe("mode switch reaches open pages @desktop-only", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("completed");
  });

  test("player pages follow tournament → Elo → tournament without reloading", async ({ browser }) => {
    test.setTimeout(150_000);
    const player = await asRole(browser, "player");
    await player.goto("/");
    await expect(player.getByRole("region", { name: "Turniersieger" })).toBeVisible();

    const admin = await asRole(browser, "admin");
    await admin.goto("/admin");
    await admin.getByRole("button", { name: "Zum Elo-Modus wechseln" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Jetzt wechseln" }).click();
    await toast(admin, "Elo-Modus aktiv.");
    await expect(player.getByText("Elo-Modus · freies Spiel")).toBeVisible(MODE_FOLLOW);
    await expect(player.getByRole("link", { name: "Spielen" }).first()).toBeVisible();

    await admin.getByRole("button", { name: "Zurück zum Turnier" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Jetzt wechseln" }).click();
    await toast(admin, "Turniermodus aktiv.");
    await expect(player.getByRole("region", { name: "Turniersieger" })).toBeVisible(MODE_FOLLOW);
  });
});

async function liveMatchId(page: Page): Promise<string> {
  const json = await (await page.request.get("/api/elo/live")).json();
  return json.liveMatches[0].id as string;
}

const SCANS: { role: Role | null; paths: string[] }[] = [
  { role: null, paths: ["/", "/elo/rankings", "/elo/table/1", "/rules", "/display"] },
  { role: "player", paths: ["/", "/elo/play?table=1", "/elo/rankings", "/elo/players/me"] },
  { role: "referee", paths: ["/elo/referee"] },
  { role: "admin", paths: ["/admin", "/admin/elo"] },
];

test.describe("Elo pages: accessibility", () => {
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("elo");
  });
  for (const { role, paths } of SCANS) {
    test.describe(`as ${role ?? "guest"}`, () => {
      if (role) test.use({ storageState: storageStateFor(role) });
      for (const path of paths) {
        test(`${path} has no serious axe violations`, async ({ page }) => {
          await axeScan(page, path);
        });
      }
      if (role === "player") {
        test("/elo/matches/<id> has no serious axe violations", async ({ page }) => {
          await page.goto("/");
          await axeScan(page, `/elo/matches/${await liveMatchId(page)}`);
        });
      }
    });
  }
});

test.describe("Elo pages: phone layout @mobile-only", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("elo");
  });
  for (const { role, paths } of SCANS.filter((s) => s.role !== "admin")) {
    test.describe(`as ${role ?? "guest"}`, () => {
      if (role) test.use({ storageState: storageStateFor(role) });
      for (const path of paths.filter((p) => p !== "/display")) {
        test(`${path} fits the phone`, async ({ page }) => {
          await checkPhoneLayout(page, path);
        });
      }
      if (role === "player") {
        test("/elo/matches/<id> fits the phone", async ({ page }) => {
          await page.goto("/");
          await checkPhoneLayout(page, `/elo/matches/${await liveMatchId(page)}`);
        });
      }
    });
  }
});
