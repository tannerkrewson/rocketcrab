import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The screenshot row must stay inside its column as images load, fail and
 * the viewport changes. Block remote images to keep layout tests independent
 * of the network, including failed loads.
 */
test("screenshot row keeps a sane width as assets load and on resize", async ({ page }) => {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "image") return route.abort();
    return route.continue();
  });

  await page.goto("/game/drawphone");
  const row = page.getByTestId("screenshot-row");
  await expect(row).toBeVisible();

  await page.waitForTimeout(1500);
  const column = page.locator(".mx-auto.max-w-2xl").first();
  const columnWidth = await column.evaluate((el) => el.clientWidth);
  const widthAfterLoad = await row.evaluate((el) => el.clientWidth);
  expect(widthAfterLoad).toBeGreaterThan(0);
  expect(widthAfterLoad).toBeLessThanOrEqual(columnWidth);

  await page.setViewportSize({ width: 900, height: 720 });
  await page.waitForTimeout(800);
  const widthAfterResize = await row.evaluate((el) => el.clientWidth);
  expect(widthAfterResize).toBeGreaterThan(0);
  expect(widthAfterResize).toBeLessThanOrEqual(await column.evaluate((el) => el.clientWidth));
});

test("arrow buttons scroll the screenshot row on wide screens", async ({ page }) => {
  const image = fileURLToPath(new URL("../apps/nova/public/icon-512.png", import.meta.url));
  await page.route("https://i.imgur.com/*.png", (route) => route.fulfill({ path: image }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/game/drawphone");
  const row = page.getByTestId("screenshot-row");
  await expect(row).toBeVisible();

  const more = page.getByRole("button", { name: "More screenshots" });
  await expect(more).toBeVisible();
  await more.click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Previous screenshots" })).toBeVisible();
});

test("back link is a compact button, not a full-width bar", async ({ page }) => {
  await page.goto("/game/drawphone");
  const back = page.getByRole("link", { name: "Back to games" });
  await expect(back).toBeVisible();
  await expect(back).toHaveClass(/button--tertiary/);

  const backBox = await back.boundingBox();
  const columnBox = await page.locator(".mx-auto.max-w-2xl").first().boundingBox();
  expect(backBox).not.toBeNull();
  expect(columnBox).not.toBeNull();
  expect(backBox!.width).toBeLessThan(columnBox!.width);
  expect(backBox!.x).toBeLessThan(columnBox!.x + columnBox!.width / 2);
});
