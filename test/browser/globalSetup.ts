/**
 * globalSetup for the browser-mode E2E suite.
 *
 * 1. Ensures the app is built (dist/server/server.js fresh vs. sources).
 * 2. Spawns the repo's real server (server/with-tanstack.ts) in production
 *    mode on ROCKETCRAB_TEST_PORT (default 3010).
 * 3. Waits until the server answers /api/stats.
 *
 * The returned function is the teardown — it kills the spawned server.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.ROCKETCRAB_TEST_PORT || 3010);
const APP_URL = `http://localhost:${PORT}`;
const SERVER_ENTRY = path.join(ROOT, "dist/server/server.js");
const SERVER_SRC = path.join(ROOT, "server/with-tanstack.ts");

const WATCH_DIRS = ["app", "server", "components", "utils", "config", "types", "styles"];

let serverProcess: ChildProcess | undefined;

/** Newest mtime (ms) under a directory, recursing one level of subdirs deep. */
function newestMtimeMs(dir: string): number {
    let newest = 0;
    if (!existsSync(dir)) return newest;
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
            const st = statSync(full);
            if (st.isDirectory()) {
                for (const sub of readdirSync(full)) {
                    const subFull = path.join(full, sub);
                    try {
                        const subSt = statSync(subFull);
                        if (subSt.isFile()) newest = Math.max(newest, subSt.mtimeMs);
                    } catch {
                        /* ignore */
                    }
                }
            } else if (st.isFile()) {
                newest = Math.max(newest, st.mtimeMs);
            }
        } catch {
            /* ignore */
        }
    }
    return newest;
}

function ensureBuild(): void {
    if (process.env.ROCKETCRAB_TEST_SKIP_BUILD === "1") return;
    if (process.env.ROCKETCRAB_TEST_REBUILD === "1") {
        build();
        return;
    }
    if (!existsSync(SERVER_ENTRY) || !existsSync(SERVER_SRC)) {
        build();
        return;
    }
    const distTime = statSync(SERVER_ENTRY).mtimeMs;
    const newestSource = Math.max(...WATCH_DIRS.map((d) => newestMtimeMs(path.join(ROOT, d))));
    if (newestSource > distTime + 5000) {
        console.log("[globalSetup] Sources are newer than dist/ — rebuilding app...");
        build();
    }
}

function build(): void {
    const result = spawnSync("npm", ["run", "build"], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, CI: process.env.CI || "1" },
    });
    if (result.status !== 0) {
        throw new Error(`App build failed (status ${result.status})`);
    }
}

async function waitForServer(timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${APP_URL}/api/stats`);
            if (res.ok) {
                console.log(`[globalSetup] App server ready at ${APP_URL}`);
                return;
            }
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`App server did not become ready at ${APP_URL} in ${timeoutMs}ms`);
}

export default async function setup(): Promise<() => Promise<void>> {
    ensureBuild();

    // Avoid port collisions from stale test servers.
    try {
        spawnSync("pkill", ["-f", "server/with-tanstack.ts"], { stdio: "ignore" });
    } catch {
        /* no leftover server */
    }
    await new Promise((r) => setTimeout(r, 300));

    serverProcess = spawn(
        path.join(ROOT, "node_modules/.bin/tsx"),
        ["server/with-tanstack.ts"],
        {
            cwd: ROOT,
            env: { ...process.env, NODE_ENV: "production", PORT: String(PORT) },
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    serverProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[app-server] ${d}`));
    serverProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[app-server] ${d}`));
    serverProcess.on("exit", (code) => {
        serverProcess = undefined;
        if (code !== 0 && code !== null) {
            console.error(`[globalSetup] app server exited with code ${code}`);
        }
    });

    await waitForServer();
    return teardown;
}

export async function teardown(): Promise<void> {
    if (serverProcess) {
        serverProcess.kill("SIGTERM");
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => resolve(), 5000);
            serverProcess?.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
        serverProcess = undefined;
    }
}
