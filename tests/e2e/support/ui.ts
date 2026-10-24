import { expect, type Locator, type Page } from "@playwright/test";

/** Press and hold (HoldToConfirm) with the mouse for `ms`. */
export async function holdToConfirm(page: Page, button: Locator, ms = 1600): Promise<void> {
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("hold button has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** The visible tab panel of a Tabs component. */
export function activeTabPanel(page: Page): Locator {
  return page.getByRole("tabpanel").filter({ visible: true }).first();
}
