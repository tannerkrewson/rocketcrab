import { expect, test, type Locator } from "@playwright/test";

/** Swiper exposes its instance on the container element. */
type SwiperEl = HTMLElement & { swiper: { realIndex: number } };

function realIndex(carousel: Locator): Promise<number> {
  return carousel.evaluate((el) => (el as SwiperEl).swiper.realIndex);
}

/**
 * A definite Swiper width prevents slide sizing and container min-content
 * measurements from feeding back into unbounded growth. Block remote images
 * to keep layout tests independent of the network, including failed loads.
 */
test("screenshot carousel keeps a sane width as assets load and on resize", async ({ page }) => {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "image") return route.abort();
    return route.continue();
  });

  await page.goto("/game/drawphone");
  const carousel = page.locator(".swiper.nova-screenshots");
  await expect(carousel).toBeVisible();

  // Give image error/font swap events time to trigger swiper re-measures.
  await page.waitForTimeout(1500);
  const widthAfterLoad = await carousel.evaluate((el) => el.clientWidth);
  expect(widthAfterLoad).toBeGreaterThan(0);
  expect(widthAfterLoad).toBeLessThan(2000);

  await page.setViewportSize({ width: 900, height: 720 });
  await page.waitForTimeout(800);
  const widthAfterResize = await carousel.evaluate((el) => el.clientWidth);
  expect(widthAfterResize).toBeGreaterThan(0);
  expect(widthAfterResize).toBeLessThan(2000);
});

test("pagination keeps the selected slide across a re-measure", async ({ page }) => {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "image") return route.abort();
    return route.continue();
  });

  await page.goto("/game/drawphone");
  const carousel = page.locator(".swiper.nova-screenshots");
  await expect(carousel).toBeVisible();

  // Swiper creates its pagination bullets on init, so the bullet exists once
  // the carousel can be driven.
  const slideThree = page.getByRole("button", { name: "Go to slide 3" });
  await expect(slideThree).toBeVisible();
  await slideThree.click();
  await expect.poll(() => realIndex(carousel), { timeout: 3000 }).toBe(2);

  // The theme switcher that used to force a re-render is gone; a viewport
  // resize makes Swiper re-measure every slide instead.
  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(() => realIndex(carousel), { timeout: 3000 }).toBe(2);

  await expect(page.getByRole("button", { name: "Go to slide 3" })).toHaveClass(
    /swiper-pagination-bullet-active/,
  );
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
