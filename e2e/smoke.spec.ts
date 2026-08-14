import { expect, test } from "@playwright/test";

test("Nova home page renders with the primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("rocketcrab.com");
  await expect(page.getByRole("link", { name: "Join party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Build a game" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My games" })).toBeVisible();
});

test("runtime origin serves its isolated page", async ({ request }) => {
  const response = await request.get("http://localhost:5174/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("Rocketcrab Nova Runtime");
});
