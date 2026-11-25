import { expect, test } from "@playwright/test";

test("a blocked signaling connection warns and recovers automatically", async ({ page }) => {
  test.setTimeout(60_000);
  let blocked = true;
  let attempts = 0;
  await page.routeWebSocket(/\/api\/signal\//, (socket) => {
    attempts++;
    if (blocked) socket.close();
    else socket.connectToServer();
  });
  await page.goto("/party");
  await page.getByLabel("Enter your name here").fill("Host");
  await page.getByRole("button", { name: "Start party", exact: true }).click();
  const warning = page.getByText(
    "Can't reach Rocketcrab's servers. Check your internet connection. We'll keep trying to connect.",
  );
  await expect(warning).toBeVisible();
  await expect(page.getByText("Creating your private party…")).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  // Retrying past the join deadline is covered with fake clocks in the engine
  // and transport unit tests; here the real socket only has to come back.
  expect(attempts).toBeGreaterThan(0);
  await expect(warning).toBeVisible();
  blocked = false;
  await expect(warning).toBeHidden({ timeout: 25_000 });
  await expect(page.getByText("Creating your private party…")).toBeHidden();
  await expect(page.getByRole("region", { name: "Invite your friends" })).toBeVisible();
  await expect(
    page.getByText("Couldn't reach the party's signaling relays.", { exact: false }),
  ).toBeHidden();
});
