import { expect, test, type Locator } from "@playwright/test";

/** Swiper exposes its instance on the container element. */
type SwiperEl = HTMLElement & { swiper: { realIndex: number } };

function realIndex(carousel: Locator): Promise<number> {
  return carousel.evaluate((el) => (el as SwiperEl).swiper.realIndex);
}

/**
 * Game detail page spec (rocketcrab-9fv.11.12): the screenshot carousel
 * must keep a sane, stable layout. Regression: without a definite container
 * width the swiper sized each slide as containerWidth / slidesPerView while
 * the container's own width followed the wrapper's min-content (the sum of
 * non-shrinking slide widths) — so every re-measure (image load/error, font
 * swap, resize) widened the slides again in a runaway feedback loop until
 * the layout clamped at ~33.5M px. The gallery rendered off-screen and
 * appeared to flicker/jump.
 *
 * The remote screenshot images are routed away so the tests do not depend
 * on the network — the bug reproduced even when images failed to load.
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

  // A viewport resize re-measures the carousel too; it must stay sane.
  await page.setViewportSize({ width: 900, height: 720 });
  await page.waitForTimeout(800);
  const widthAfterResize = await carousel.evaluate((el) => el.clientWidth);
  expect(widthAfterResize).toBeGreaterThan(0);
  expect(widthAfterResize).toBeLessThan(2000);
});

test("pagination keeps the selected slide across a page re-render", async ({ page }) => {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "image") return route.abort();
    return route.continue();
  });

  await page.goto("/game/drawphone");
  const carousel = page.locator(".swiper.nova-screenshots");
  await expect(carousel).toBeVisible();
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Go to slide 3" }).click();
  await expect.poll(() => realIndex(carousel), { timeout: 3000 }).toBe(2);

  // Re-rendering the whole app (theme toggle) must not reset the carousel
  // back to the first slide.
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect.poll(() => realIndex(carousel), { timeout: 3000 }).toBe(2);

  // And the active dot still points at the third screenshot.
  await expect(page.getByRole("button", { name: "Go to slide 3" })).toHaveClass(
    /swiper-pagination-bullet-active/,
  );
});

test("back link is a compact button, not a full-width bar", async ({ page }) => {
  await page.goto("/game/drawphone");
  const back = page.getByRole("link", { name: "Back to games" });
  await expect(back).toBeVisible();
  await expect(back).toHaveClass(/btn-outline/);

  // It sits left-aligned and only as wide as its label, inside the page
  // column (the pre-fix version stretched across the whole column).
  const backBox = await back.boundingBox();
  const columnBox = await page.locator(".mx-auto.max-w-2xl").first().boundingBox();
  expect(backBox).not.toBeNull();
  expect(columnBox).not.toBeNull();
  expect(backBox!.width).toBeLessThan(columnBox!.width);
  expect(backBox!.x).toBeLessThan(columnBox!.x + columnBox!.width / 2);
});
