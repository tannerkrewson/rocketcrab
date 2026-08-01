import { expect, test } from "@playwright/test";

test("Nova home page renders with the three primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rocketcrab Nova");
  await expect(page.getByRole("link", { name: "Create a game" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join a party" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My games" })).toBeVisible();
});

test("runtime origin serves its isolated page", async ({ request }) => {
  const response = await request.get("http://localhost:5174/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("Rocketcrab Nova Runtime");
});
