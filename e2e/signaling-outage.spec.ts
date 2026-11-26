import { expect, test } from "@playwright/test";

test("a blocked signaling connection warns and recovers automatically", async ({ page }) => {
  test.setTimeout(60_000);
  // Use a rejected HTTP upgrade so the browser never observes a transient
  // OPEN socket while signaling is blocked.
  await page.addInitScript(() => {
    const state = Object.assign(window, { blockSignaling: true });
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const target = new URL(url, location.href);
        if (state.blockSignaling && target.pathname.startsWith("/api/signal/")) {
          target.pathname = "/api/signal/invalid";
        }
        super(target, protocols);
      }
    };
  });
  await page.goto("/party");
  await page.getByLabel("Enter your name here").fill("Host");
  await page.getByRole("button", { name: "Start party", exact: true }).click();
  const warning = page.getByText(
    "Can't reach rocketcrab's servers. Check your internet connection. We'll keep trying to connect.",
  );
  await expect(warning).toBeVisible();
  await expect(page.getByText("Creating your private party…")).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  // Retrying past the join deadline is covered with fake clocks in the engine
  // and transport unit tests; here the real socket only has to come back.
  await page.evaluate(() => {
    (window as Window & { blockSignaling: boolean }).blockSignaling = false;
  });
  await expect(warning).toBeHidden({ timeout: 25_000 });
  await expect(page.getByText("Creating your private party…")).toBeHidden();
  await expect(page.getByRole("region", { name: "Invite your friends" })).toBeVisible();
  await expect(
    page.getByText("Couldn't reach the party's signaling relays.", { exact: false }),
  ).toBeHidden();
});
