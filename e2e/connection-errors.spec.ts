import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// The app has no room cap and different invite secrets derive different rooms.
// Inject a typed transport report, not a fabricated timeout classification;
// the real signaling, join wait, teardown and UI still run in the browser.
for (const [code, title, message] of [
  ["room-full", "This party is full", "Ask the host for help joining."],
  ["decrypt-failed", "This invite couldn't be used", "Ask the host for a fresh invite link."],
] as const) {
  test(`${code} is shown after a failed join and can be retried`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.route("**/src/lib/party/transport-factory.ts*", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = "return transport;";
      expect(source).toContain(marker);
      await route.fulfill({
        response,
        body: source.replace(
          marker,
          `setTimeout(() => onJoinError?.({code: ${JSON.stringify(code)}, category: "unknown", message: "simulated peer error"}), 100);\n${marker}`,
        ),
      });
    });
    await page.goto(`/join#secret=${randomBytes(32).toString("base64url")}`);
    await expect(
      page.getByText("Connecting to the private party.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByText("Connecting to the private party.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(title, { exact: true })).toBeHidden();
  });
}

test("an invite with no room contact stays a generic timeout", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto(`/join#secret=${randomBytes(32).toString("base64url")}`);
  await expect(page.getByText("The party couldn't be set up")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Couldn't reach anyone in this party.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("This invite couldn't be used")).toBeHidden();
});
