import { expect, test } from "@playwright/test";

test("Nova home page renders with the primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("rocketcrab.com");
  await expect(page.getByRole("button", { name: "Join party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Build a game" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My games" })).toBeVisible();
});

test("starting a party launches the crab and respects reduced motion", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "rc-logo-launch") {
        sessionStorage.setItem("test:launch-path", location.pathname);
      }
    });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("link", { name: "Start party" }).click();
  await expect(page).toHaveURL(/\/party$/);
  expect(await page.evaluate(() => sessionStorage.getItem("test:launch-path"))).toBe("/");

  await page.evaluate(() => sessionStorage.removeItem("test:launch-path"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: "Start party" }).press("Enter");
  await expect(page).toHaveURL(/\/party$/);
  expect(await page.evaluate(() => sessionStorage.getItem("test:launch-path"))).toBeNull();
});

test("runtime origin serves its isolated page", async ({ request }) => {
  const response = await request.get("http://localhost:2723/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("Rocketcrab Nova Runtime");
});
