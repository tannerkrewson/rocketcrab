#!/usr/bin/env node
/**
 * CI deploy for main: deploy each Worker whose inputs changed since the
 * commit its live version was tagged with (scripts/deploy-static.mjs tags
 * every clean deploy). The runtime goes first, so a new app never frames an
 * older runtime. Skipping an unchanged app matters: every app deploy restarts
 * its Durable Objects, which drops live signaling and tunnel sockets.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WRANGLER = ["--yes", "wrangler@4.161.0"];
const SHA = /^[0-9a-f]{40}$/;

// Files that never reach a deployed Worker.
const NEVER_DEPLOYED = [
  /\.md$/,
  /\.test\.tsx?$/,
  /^e2e(-trystero)?\//,
  /^\.github\//,
  /^lefthook\.yml$/,
  /^playwright\.config\.ts$/,
  /^\.oxfmtrc\.json$/,
  /^\.oxlintrc\.json$/,
  /^deploy\/nova\/.*\.integration\.mjs$/,
];
const OTHER_TARGET = {
  runtime: [/^apps\/nova\//, /^deploy\/nova\//],
  nova: [/^apps\/runtime\//, /^deploy\/runtime\//],
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function workerName(target) {
  const config = readFileSync(
    new URL(`../deploy/${target}/wrangler.toml`, import.meta.url),
    "utf8",
  );
  return /^name\s*=\s*"([^"]+)"/m.exec(config)[1];
}

/** The commit the Worker's live version was built from, or null if unknown. */
function deployedSha(name) {
  const list = run("npx", [...WRANGLER, "deployments", "list", "--name", name, "--json"]);
  if (list.status !== 0) throw new Error(`Couldn't list ${name} deployments:\n${list.stderr}`);
  const latest = JSON.parse(list.stdout).at(-1);
  const version = latest?.versions?.toSorted((a, b) => b.percentage - a.percentage)[0];
  if (version === undefined) return null;
  const view = run("npx", [
    ...WRANGLER,
    "versions",
    "view",
    version.version_id,
    "--name",
    name,
    "--json",
  ]);
  if (view.status !== 0) throw new Error(`Couldn't read ${name} version:\n${view.stderr}`);
  const tag = JSON.parse(view.stdout).annotations?.["workers/tag"];
  return SHA.test(tag ?? "") ? tag : null;
}

function changedFiles(since) {
  if (since === null || run("git", ["cat-file", "-e", `${since}^{commit}`]).status !== 0) {
    return null;
  }
  return run("git", ["diff", "--name-only", since, "HEAD"]).stdout.split("\n").filter(Boolean);
}

function needsDeploy(target, files) {
  if (files === null) return true;
  const ignored = [...NEVER_DEPLOYED, ...OTHER_TARGET[target]];
  return files.some((file) => !ignored.some((pattern) => pattern.test(file)));
}

for (const target of ["runtime", "nova"]) {
  const name = workerName(target);
  const since = deployedSha(name);
  const files = changedFiles(since);
  if (!needsDeploy(target, files)) {
    console.log(`${name}: unchanged since ${since.slice(0, 7)}, skipping.`);
    continue;
  }
  console.log(
    `${name}: deploying (${since === null ? "no tagged deploy" : `changed since ${since.slice(0, 7)}`}).`,
  );
  const deploy = run("node", ["scripts/deploy-static.mjs", target], { stdio: "inherit" });
  if (deploy.status !== 0) process.exit(deploy.status ?? 1);
}
