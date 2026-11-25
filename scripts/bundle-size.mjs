#!/usr/bin/env node
// Bundle-size report for the two static origins.
//
// Lists built asset sizes for apps/nova and apps/runtime and prints a
// warning (exit 0, non-failing) when the Nova initial JS bundle exceeds the
// documented budget. Gzip is what phones actually download, so it is the
// budget people care about: NOVA_BUNDLE_LIMIT_GZIP_KB (default 220 kB).
// Raw (uncompressed) size is reported for context. Values are baseline
// measurements from the 2026-10-24 launch-readiness build, not hard gates.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const GZIP_LIMIT_KB = Number(process.env.NOVA_BUNDLE_LIMIT_GZIP_KB ?? 220);
const gzipLimitBytes = GZIP_LIMIT_KB * 1024;

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
      const bytes = stat.size;
      const gzipBytes =
        entry.endsWith(".js") || entry.endsWith(".css") || entry.endsWith(".html")
          ? gzipSync(readFileSync(path)).length
          : null;
      out.push({ path: join(prefix, entry), bytes, gzipBytes });
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
    const gzip =
      a.gzipBytes === null ? "".padStart(10) : ` (${format(a.gzipBytes)} gz)`.padStart(22);
    console.log(`  ${format(a.bytes).padStart(9)}${gzip}  ${a.path}`);
  }

  const main = assets.find((a) => /^assets\/index-.*\.js$/.test(a.path));
  if (main && main.gzipBytes !== null && main.gzipBytes > gzipLimitBytes) {
    warned = true;
    console.warn(
      `\n⚠ ${name} initial JS is ${format(main.gzipBytes)} gzipped, ` +
        `exceeding the documented budget of ${format(gzipLimitBytes)} ` +
        `(NOVA_BUNDLE_LIMIT_GZIP_KB=${GZIP_LIMIT_KB}). Investigate the regression.`,
    );
  }
}

if (warned) {
  console.log(
    "\nBundle-size warning emitted (non-failing). See scripts/bundle-size.mjs for the threshold.",
  );
}
