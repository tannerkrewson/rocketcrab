import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// Room-full and decrypt-failed join failures are classified in the engine
// (engine.test.ts) and rendered in routes/party.test.tsx; this file keeps the
// real-browser paths: a live-party peer notice and a real join timeout.
test("peer errors in a live party are qualified notices, not party failures", async ({ page }) => {
  await page.route("**/src/lib/party/transport-factory.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain("return transport;");
    await route.fulfill({
      response,
      body: source.replace(
        "return transport;",
        "window.__reportPeerError = onJoinError; return transport;",
      ),
    });
  });
  await page.goto("/party");
  await page.getByLabel("Enter your name here").fill("Host");
  await page.getByRole("button", { name: "Start party", exact: true }).click();
  const lobby = page.getByRole("region", { name: "Invite your friends" });
  await expect(lobby).toBeVisible();
  for (const [code, message] of [
    ["room-full", "A player reported the party may be full"],
    ["decrypt-failed", "A message from another player couldn't be decrypted"],
  ] as const) {
    await page.evaluate((errorCode) => {
      const report = (window as unknown as { __reportPeerError: (error: object) => void })
        .__reportPeerError;
      report({
        code: errorCode,
        peerId: "unrelated-peer",
        category: "unknown",
        message: "test peer report",
      });
    }, code);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(lobby).toBeVisible();
  }
  await expect(page.getByText("This party is full.", { exact: false })).toBeHidden();
  await expect(
    page.getByText("This invite doesn't match the party.", { exact: false }),
  ).toBeHidden();
});

test("an invite with no room contact stays a generic timeout", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto(`/party#secret=${randomBytes(32).toString("base64url")}`);
  await page.getByLabel("Enter your name here").fill("Guest");
  await page.getByRole("button", { name: "Join party" }).click();
  await expect(page.getByText("The party couldn't be set up")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Couldn't reach anyone in this party.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("A message from a player couldn't be decrypted", { exact: false }),
  ).toBeHidden();
  await expect(
    page.getByText("A player reported the party may be full", { exact: false }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Joining the party from your invite…")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("The party couldn't be set up")).toBeHidden();
});
