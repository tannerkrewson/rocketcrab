// Real PartyEngine + runtime load experiment. Run against the three isolated
// servers described in docs/testing/large-room-load.md; never auto-start them.
import { chromium } from "playwright";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const size = Number(process.argv[2] ?? 10);
if (![10, 25, 50, 100].includes(size)) throw new Error("size must be 10, 25, 50 or 100");
const output = process.argv[3] ?? `load-${size}.json`;
const timeout = Number(process.env.LOAD_TIMEOUT_MS ?? 300_000);
const selectAfterJoin = process.env.LOAD_SELECT_AFTER_JOIN === "1";
const omitPayload = process.env.LOAD_OMIT_PAYLOAD === "1";
// Local-only proof of two independently controlled browser servers. This is
// not a distributed driver: both servers and the resource guard share a host.
const twoLocalServers = process.env.LOAD_TWO_LOCAL_SERVERS === "1";
if (twoLocalServers && size > 10) throw new Error("Two-server proof is limited to 10 contexts");
const minAvailable = Number(process.env.LOAD_MIN_AVAILABLE_KIB ?? 6 * 1024 * 1024);
const maxSwapGrowth = Number(process.env.LOAD_MAX_SWAP_GROWTH_KIB ?? 512 * 1024);
if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid LOAD_TIMEOUT_MS");
if (!Number.isFinite(minAvailable) || minAvailable < 6 * 1024 * 1024)
  throw new Error("LOAD_MIN_AVAILABLE_KIB cannot be below 6 GiB");
if (!Number.isFinite(maxSwapGrowth) || maxSwapGrowth < 0 || maxSwapGrowth > 512 * 1024)
  throw new Error("LOAD_MAX_SWAP_GROWTH_KIB must be between 0 and 512 MiB");
const hz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const start = performance.now();
const result = {
  size,
  startedAt: new Date().toISOString(),
  timeoutMs: timeout,
  minAvailableKiB: minAvailable,
  maxSwapGrowthKiB: maxSwapGrowth,
  selectAfterJoin,
  omitPayload,
  twoLocalServers,
  stages: {},
  errors: [],
  samples: {},
  status: "running",
};
let hostServer, guestServer, host, guests;
const pages = [];
let stopped = false;
let minObserved = Infinity;
let initialSwap;
let maxSwap = 0;
let maxLoopDelayMs = 0;
let guardFailure;
const guard = new Promise((_, reject) => {
  guardFailure = reject;
});
// A guard may fire between guarded stages; avoid an unhandled-rejection exit
// so the next guarded await can record the failure and clean up.
void guard.catch(() => {});
const watcher = (async () => {
  let lastCheck = performance.now();
  while (!stopped) {
    const now = performance.now();
    const delay = now - lastCheck;
    maxLoopDelayMs = Math.max(maxLoopDelayMs, delay);
    if (delay > 10_000) {
      guardFailure(new Error(`Responsiveness guard: event-loop delay ${delay.toFixed(0)} ms`));
      return;
    }
    lastCheck = now;
    const memory = readFileSync("/proc/meminfo", "utf8");
    const availableMatch = /^MemAvailable:\s+(\d+)/m.exec(memory);
    const totalMatch = /^SwapTotal:\s+(\d+)/m.exec(memory);
    const freeMatch = /^SwapFree:\s+(\d+)/m.exec(memory);
    if (!availableMatch || !totalMatch || !freeMatch) {
      guardFailure(new Error("Resource monitor failed: cannot read memory and swap counters"));
      return;
    }
    const available = Number(availableMatch[1]);
    const swap = Number(totalMatch[1]) - Number(freeMatch[1]);
    initialSwap ??= swap;
    maxSwap = Math.max(maxSwap, swap);
    minObserved = Math.min(minObserved, available);
    if (available < minAvailable) {
      guardFailure(new Error(`Memory guard: ${available} KiB available`));
      return;
    }
    if (swap - initialSwap > maxSwapGrowth) {
      guardFailure(new Error(`Swap guard: grew ${swap - initialSwap} KiB`));
      return;
    }
    await sleep(1000);
  }
})().catch((error) => guardFailure(new Error(`Resource monitor failed: ${String(error)}`)));
const guarded = (p) => Promise.race([p, guard]);
async function until(label, fn, limit = timeout) {
  const deadline = performance.now() + limit;
  let last;
  while (performance.now() < deadline) {
    last = await guarded(fn());
    if (last === true) return;
    await guarded(sleep(1000));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}
// Linux process-tree CPU, in clock ticks, sampled at endpoints. Separate host
// browser process includes its browser, renderer, GPU and utility processes;
// subprocesses that exit between samples may be missed.
function treeTicks(root) {
  const nodes = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      nodes.push({
        pid: Number(name),
        ppid: Number(fields[1]),
        ticks: Number(fields[11]) + Number(fields[12]),
      });
    } catch {
      /* process exited while sampling */
    }
  }
  const selected = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes)
      if (selected.has(node.ppid) && !selected.has(node.pid)) {
        selected.add(node.pid);
        changed = true;
      }
  }
  return nodes.filter((node) => selected.has(node.pid)).reduce((sum, node) => sum + node.ticks, 0);
}
async function open(browser, i) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    result.errors.push({ player: i, type: "pageerror", message: String(error) }),
  );
  page.on("crash", () => result.errors.push({ player: i, type: "crash" }));
  await page.goto(`http://localhost:5273/?player=${i}`);
  await page.waitForFunction(() => Boolean(window.loadHarness), null, { timeout: 30_000 });
  pages.push(page);
  result.samples.openedContexts = pages.length;
  return page;
}
async function states() {
  return Promise.all(pages.map((page) => page.evaluate(() => window.loadHarness.state())));
}
async function gameFrame(page) {
  for (const frame of page.frames()) {
    try {
      if (await frame.locator("#load-state").count()) return frame;
    } catch {
      /* navigating */
    }
  }
  return null;
}
async function gameCount(page) {
  const frame = await gameFrame(page);
  if (!frame) return null;
  return frame.locator("#load-state").textContent();
}
try {
  hostServer = await guarded(chromium.launchServer({ headless: true }));
  if (twoLocalServers) {
    guestServer = await guarded(chromium.launchServer({ headless: true }));
    guests = await guarded(
      chromium.connect(guestServer.wsEndpoint(), {
        exposeNetwork: "localhost:5273,localhost:5274,localhost:5287",
      }),
    );
  } else {
    guests = await guarded(chromium.launch({ headless: true }));
  }
  host = await guarded(chromium.connect(hostServer.wsEndpoint()));
  const hostPage = await guarded(open(host, 0));
  await guarded(
    hostPage.evaluate((withGame) => window.loadHarness.create(withGame), !selectAfterJoin),
  );
  const initial = await hostPage.evaluate(() => window.loadHarness.state());
  if (initial.phase !== "lobby" || !initial.inviteUrl)
    throw new Error(
      `Host create failed: ${JSON.stringify({ phase: initial.phase, error: initial.lastError })}`,
    );
  // Use the production invite parser without logging the secret.
  const invite = await hostPage.evaluate(() => window.loadHarness.inviteSecret());
  if (!invite) throw new Error("Could not parse invite");
  const joinStarted = performance.now();
  for (let i = 1; i < size; i++) {
    const page = await guarded(open(guests, i));
    // Sequential admission is reproducible and avoids an artificial join burst.
    await guarded(page.evaluate((s) => window.loadHarness.join(s), invite));
    const state = await page.evaluate(() => window.loadHarness.state());
    if (state.phase !== "lobby")
      throw new Error(
        `Player ${i} join failed: ${JSON.stringify({ phase: state.phase, error: state.lastError, notices: state.notices })}`,
      );
    result.samples.joinedPlayers = i + 1;
    console.log(`joined ${i + 1}/${size}`);
  }
  result.stages.joinMs = performance.now() - joinStarted;
  await until("all-see-all", async () => {
    const all = await states();
    const expected = new Set(all.map((s) => s.memberId));
    const counts = all.map(
      (s) =>
        new Set(
          s.members.filter((m) => m.connected && expected.has(m.memberId)).map((m) => m.memberId),
        ).size,
    );
    result.samples.lastRosterCounts = counts;
    return (
      (expected.size === size &&
        all.every((s, i) => s.members.length === size && counts[i] === size)) ||
      counts
    );
  });
  result.stages.allSeeAllMs = performance.now() - joinStarted;
  if (selectAfterJoin) await guarded(hostPage.evaluate(() => window.loadHarness.selectGame()));
  await until("source transfer and ready", async () => {
    const all = await states();
    result.samples.phases = all.map((s) => ({
      phase: s.phase,
      game: s.game?.mode,
      ready: s.members.find((m) => m.isSelf)?.ready,
      error: s.lastError,
    }));
    result.samples.hostStart = {
      canStart: all[0].canStart,
      reason: all[0].startBlockedReason,
      members: all[0].members,
    };
    return (
      (all[0].canStart &&
        all.every((s) => s.game?.mode === "state" && s.members.find((m) => m.isSelf)?.ready)) ||
      result.samples.hostStart
    );
  });
  result.stages.readyMs = performance.now() - joinStarted;
  await hostPage.evaluate(() => window.loadHarness.start());
  await until("state game starts", async () => {
    const values = await Promise.all(pages.map(gameCount));
    result.samples.lastGameCounts = values;
    return values.every((value) => value === "0") || values;
  });
  const afterStart = await states();
  result.samples.authorityIds = [...new Set(afterStart.map((s) => s.authorityMemberId))];
  const hostIsAuthority =
    result.samples.authorityIds.length === 1 && result.samples.authorityIds[0] === initial.memberId;
  const frames = await Promise.all(pages.map(gameFrame));
  if (frames.some((frame) => !frame)) throw new Error("Game frame disappeared");
  const cpuStart = hostIsAuthority ? treeTicks(hostServer.process().pid) : null;
  const guestCpuStart = guestServer ? treeTicks(guestServer.process().pid) : null;
  const batchStart = performance.now();
  const latencies = [];
  for (let count = 1; count <= 10; count++) {
    // Register all observers before the click. Ten-millisecond polling and
    // the driver/Playwright round trip bound the precision of these samples.
    const observed = Promise.all(
      frames.map((frame) =>
        frame.waitForFunction(
          (expected) => document.querySelector("#load-state")?.textContent === String(expected),
          count,
          { timeout, polling: 10 },
        ),
      ),
    );
    void observed.catch(() => {});
    const actionStart = performance.now();
    await guarded(
      frames[1].locator(omitPayload ? "#increment-without-payload" : "#increment").click(),
    );
    const handles = await guarded(observed);
    latencies.push(performance.now() - actionStart);
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
  const elapsed = performance.now() - batchStart;
  const cpuTicks = cpuStart === null ? null : treeTicks(hostServer.process().pid) - cpuStart;
  // A disappearing child can make endpoint subtraction negative; do not
  // misrepresent that as CPU consumption.
  const cpuSeconds = cpuTicks === null || cpuTicks < 0 ? null : cpuTicks / hz;
  result.samples.actionToAllMs = latencies;
  result.samples.authorityBrowserCpuSeconds = cpuSeconds;
  const guestTicks =
    guestCpuStart === null ? null : treeTicks(guestServer.process().pid) - guestCpuStart;
  result.samples.guestBrowserCpuSeconds =
    guestTicks === null || guestTicks < 0 ? null : guestTicks / hz;
  result.samples.authorityBrowserAverageCores =
    cpuSeconds === null ? null : cpuSeconds / (elapsed / 1000);
  result.samples.actionBatchMs = elapsed;
  const observedErrors = await Promise.all(
    pages.map((page) => page.evaluate(() => window.loadHarness.errors())),
  );
  observedErrors.forEach((errors, player) =>
    errors.forEach((message) => result.errors.push({ player, type: "engine", message })),
  );
  result.status = result.errors.length ? "failed" : "passed";
} catch (error) {
  result.status = "failed";
  result.errors.push({ type: "run", message: String(error) });
  try {
    // Under resource pressure prioritize immediate browser teardown over diagnostics.
    if (
      /^(Error: )?((Memory|Swap|Responsiveness) guard:|Resource monitor failed:)/.test(
        String(error),
      )
    )
      throw error;
    result.samples.finalStates = (await Promise.race([states(), sleep(5000).then(() => [])])).map(
      (s) => ({
        phase: s.phase,
        memberCount: s.members.length,
        error: s.lastError,
        notices: s.notices,
      }),
    );
    const observedErrors = await Promise.race([
      Promise.all(pages.map((page) => page.evaluate(() => window.loadHarness.errors()))),
      sleep(5000).then(() => []),
    ]);
    observedErrors.forEach((errors, player) =>
      errors.forEach((message) => result.errors.push({ player, type: "engine", message })),
    );
  } catch {
    /* crashed pages */
  }
} finally {
  stopped = true;
  result.elapsedMs = performance.now() - start;
  result.samples.minAvailableKiB = Number.isFinite(minObserved) ? minObserved : null;
  result.samples.initialSwapUsedKiB = initialSwap ?? null;
  result.samples.maxSwapUsedKiB = maxSwap;
  result.samples.maxWatchIntervalMs = maxLoopDelayMs;
  await Promise.allSettled([
    host?.close(),
    guests?.close(),
    hostServer?.close(),
    guestServer?.close(),
  ]);
  await watcher;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
if (result.status !== "passed") process.exitCode = 1;
