import { expect, test } from "@playwright/test";

/**
 * M2 deployment properties (docs/architecture/deployment.md).
 *
 * 1. Invite secrets live in URL fragments (ADR-0011). Fragments are never
 *    sent in HTTP requests, and the app must not copy them into paths or
 *    query strings (the join route imports the fragment into memory and
 *    strips it from history — apps/nova/src/lib/party/invite-import.ts).
 * 2. SPA fallback routing: reloading a normal Nova route must render the
 *    app again. In production the deploy workflow ships a byte-copy of
 *    index.html as 404.html, which GitHub Pages serves for unknown paths
 *    (checked on the built output by scripts/verify-static-deploy.mjs).
 */
test.describe("static deployment properties", () => {
  test("invite fragment is never sent in any HTTP request", async ({ page }) => {
    // A valid 43-char base64url session-secret shape (sessionSecretSchema),
    // distinctive enough to detect any copy into a path or query string.
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(`/join#secret=${secret}`);

    // The fragment is consumed and stripped from the address bar.
    await expect.poll(() => page.url()).not.toContain("secret=");

    // Give any bootstrapping requests a beat to fire, then assert the
    // secret never left the browser: not in the initial navigation, not in
    // any subsequent request (fragments are never sent; the app must not
    // copy them into path or query either).
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
