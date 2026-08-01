import { chromium } from "@playwright/test";

for (const args of [
  ["--site-per-process"],
  ["--enable-features=IsolateOrigins,site-per-process"],
  ["--site-per-process", "--disable-features=BackForwardCache"],
]) {
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  await page.setContent(`<iframe src="https://localhost:5274/"></iframe>`);
  await page.waitForTimeout(1500);
  const cdp = await browser.newBrowserCDPSession();
  const t = await cdp.send("Target.getTargets");
  const infos = t.targetInfos.map((x) => `${x.type}:${x.url.slice(0, 30)}`);
  console.log(JSON.stringify(args), "->", JSON.stringify(infos));
  await cdp.detach();
  await browser.close();
}
