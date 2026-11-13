import { expect, test } from "@playwright/test";

test("a blocked signaling connection warns and recovers automatically", async ({ page }) => {
  test.setTimeout(60_000);
  let blocked = true;
  let attempts = 0;
  await page.routeWebSocket(/\/signal\//, (socket) => {
    attempts++;
    if (blocked) socket.close();
    else socket.connectToServer();
  });
  await page.goto("/party");
  await page.getByRole("button", { name: "Start a party" }).click();
  const warning = page.getByText(
    "Can't reach Rocketcrab's servers. Check your internet connection.",
  );
  await expect(warning).toBeVisible();
  // Stay offline past the adapter's normal 15 s join deadline, so recovery
  // exercises setup retry rather than just the socket's initial backoff.
  await page.waitForTimeout(16_000);
  expect(attempts).toBeGreaterThan(0);
  await expect(warning).toBeVisible();
  blocked = false;
  await expect(warning).toBeHidden({ timeout: 25_000 });
  await expect(page.getByText("Your private party is being set up.")).toBeHidden();
  await expect(page.getByRole("region", { name: "Invite your friends" })).toBeVisible();
  await expect(
    page.getByText("Couldn't reach the party's signaling relays.", { exact: false }),
  ).toBeHidden();
});
