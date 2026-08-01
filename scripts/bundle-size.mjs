#!/usr/bin/env node
// Bundle-size report for the two static origins.
//
// Lists built asset sizes for apps/nova and apps/runtime and prints a
// warning (exit 0, non-failing) when the Nova main JS bundle exceeds the
// documented threshold. The threshold is configurable via
// NOVA_BUNDLE_LIMIT_KB (default 400 kB) and is checked in CI after the
// production build as a warning, not a gate.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT_KB = Number(process.env.NOVA_BUNDLE_LIMIT_KB ?? 400);
const limitBytes = LIMIT_KB * 1024;

const TARGETS = [
  { name: "apps/nova", dist: process.env.NOVA_DIST ?? "apps/nova/dist" },
  { name: "apps/runtime", dist: process.env.RUNTIME_DIST ?? "apps/runtime/dist" },
];

function listAssets(dir, prefix = "") {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listAssets(path, join(prefix, entry)));
    } else {
      out.push({ path: join(prefix, entry), bytes: stat.size });
    }
  }
  return out;
}

const format = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

let warned = false;
for (const { name, dist } of TARGETS) {
  const assets = listAssets(dist).filter((a) => a.path.endsWith(".js") || a.path.endsWith(".css"));
  if (assets.length === 0) {
    console.log(`\n${name}: no JS/CSS assets found at ${dist} (run build first)`);
    continue;
  }
  assets.sort((a, b) => b.bytes - a.bytes);
  const total = assets.reduce((sum, a) => sum + a.bytes, 0);
  console.log(`\n${name} (${format(total)} total):`);
  for (const a of assets) {
    console.log(`  ${format(a.bytes).padStart(9)}  ${a.path}`);
  }

  const main = assets.find((a) => /^assets\/index-.*\.js$/.test(a.path));
  if (main && main.bytes > limitBytes) {
    warned = true;
    console.warn(
      `\n⚠ ${name} main bundle is ${format(main.bytes)}, ` +
        `exceeding the documented limit of ${format(limitBytes)} ` +
        `(NOVA_BUNDLE_LIMIT_KB=${LIMIT_KB}). Investigate the regression.`,
    );
  }
}

if (warned) {
  console.log(
    "\nBundle-size warning emitted (non-failing). See scripts/bundle-size.mjs for the threshold.",
  );
}
