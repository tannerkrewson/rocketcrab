#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const target = process.argv[2];
if (target !== "nova" && target !== "runtime") {
  throw new Error("Expected nova or runtime");
}
const origins = JSON.parse(
  readFileSync(new URL("../deploy/origins.json", import.meta.url), "utf8"),
);
const env = {
  ...process.env,
  VITE_RUNTIME_ORIGIN: origins.runtime,
  VITE_MAIN_ORIGIN: origins.nova,
  VITE_GA_MEASUREMENT_ID: process.env.VITE_GA_MEASUREMENT_ID ?? "G-V569CH5H2D",
  VITE_CLARITY_PROJECT_ID: process.env.VITE_CLARITY_PROJECT_ID ?? "zix4dzz9v4",
  // Public; the widget allows rocketcrab.com.
  VITE_TURNSTILE_SITE_KEY: process.env.VITE_TURNSTILE_SITE_KEY ?? "0x4AAAAAAGSaDzKBab6kyegY",
};
const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const head = git("rev-parse", "HEAD");
const sha = head.status === 0 ? head.stdout.trim() : null;
if (target === "nova" && sha !== null) env.VITE_APP_VERSION = sha.slice(0, 7);
// Tag the Worker version with the commit it was built from, so
// scripts/deploy-changed.mjs knows what each Worker runs. A build with
// uncommitted changes gets no tag, so the next CI deploy replaces it.
const clean = git("status", "--porcelain").stdout === "";
const tag = sha !== null && clean ? ["--tag", sha] : [];
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build", "--workspace", `@rocketcrab/${target}`]);
run("node", [
  "scripts/verify-static-deploy.mjs",
  "--origin",
  target,
  "--runtime-origin",
  origins.runtime,
  "--main-origin",
  origins.nova,
]);
run("npx", [
  "--yes",
  "wrangler@4.161.0",
  "deploy",
  "--config",
  `deploy/${target}/wrangler.toml`,
  ...(process.argv.includes("--dry-run") ? ["--dry-run"] : tag),
]);
