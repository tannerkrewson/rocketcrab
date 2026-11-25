import { expect, test } from "@playwright/test";

/**
 * Static deployment properties: keep invite secrets in fragments
 * and exercise SPA route reloads. Local routing does not prove production
 * asset fallback configuration; see deploy/README.md.
 */
test.describe("static deployment properties", () => {
  test("invite fragment is never sent in any HTTP request", async ({ page }) => {
    // A valid 43-char base64url session-secret shape (sessionSecretSchema),
    // distinctive enough to detect any copy into a path or query string.
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(`/party#secret=${secret}`);

    await expect.poll(() => page.url()).not.toContain("secret=");

    // Allow bootstrap requests to fire before examining URLs for leaked secrets.
    await page.waitForTimeout(500);
    for (const url of requests) {
      expect(url, `request leaked the invite secret: ${url}`).not.toContain(secret);
    }
  });

  test("reloading a normal Nova route renders the app again", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "My games" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "My games" })).toBeVisible();
  });
});
