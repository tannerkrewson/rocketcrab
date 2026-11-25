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
};
if (target === "nova") {
  const revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  if (revision.status === 0) env.VITE_APP_VERSION = revision.stdout.trim();
}
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
  ...(process.argv.includes("--dry-run") ? ["--dry-run"] : []),
]);
