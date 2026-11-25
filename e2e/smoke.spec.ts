import { expect, test } from "@playwright/test";

test("Nova home page renders with the primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("rocketcrab.com");
  await expect(page.getByRole("button", { name: "Join party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Build a game" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My games" })).toBeVisible();
});

test("starting a party leaves the crab on the launch pad", async ({ page }) => {
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
  expect(await page.evaluate(() => sessionStorage.getItem("test:launch-path"))).toBeNull();
});

test("launches on the home and Nova pages, then returns for another launch", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const launch = page.getByRole("button", { name: "Launch rocketcrab" });
  const crab = page.getByTestId("brand-logo").locator("..");
  await launch.click();
  await expect(crab).toHaveClass(/rc-logo-launch/);
  await expect(page).toHaveURL(/\/$/);
  await expect(crab).not.toHaveClass(/rc-logo-launch/);

  await launch.press("Enter");
  await expect(crab).toHaveClass(/rc-logo-launch/);
  await page.getByRole("link", { name: "Build a game" }).click();
  await expect(page).toHaveURL(/\/build$/);
  await expect(crab).not.toHaveClass(/rc-logo-launch/);
  await launch.click();
  await expect(crab).toHaveClass(/rc-logo-launch/);

  // Changing the preference during takeoff cancels the motion and resets the button.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(crab).not.toHaveClass(/rc-logo-launch/);
  await launch.click();
  await expect(crab).toHaveCSS("animation-name", "none");
  await expect(page).toHaveURL(/\/build$/);
});

test("runtime origin serves its isolated page", async ({ request }) => {
  const response = await request.get("http://localhost:2723/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("rocketcrab Nova Runtime");
});
