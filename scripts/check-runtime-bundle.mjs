#!/usr/bin/env node
/**
 * Runtime bundle purity check (U3 acceptance: "Runtime bundle contains no
 * Nova database or party secret logic").
 *
 * Scans the built apps/runtime bundle for strings that must never appear:
 * the local game database (dexie — U2), the peer transport (Trystero — P1),
 * and party/session secrets (ADR-0011). Runs after `vite build` via the
 * runtime package's build script; fails the build on a hit.
 *
 * Note: the runtime origin may legitimately contain the protocol schemas
 * (including field names like `sessionId`), so the scan targets module and
 * secret vocabulary, not schema field names.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve relative to this script so the check works from any CWD (npm
// workspace scripts run with the workspace as CWD).
const DEFAULT_DIST = fileURLToPath(new URL("../apps/runtime/dist", import.meta.url));
const DIST = process.env.RUNTIME_DIST ?? DEFAULT_DIST;

const FORBIDDEN = ["dexie", "Trystero", "trystero", "partySecret", "sessionSecret"];

function listFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const assets = listFiles(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
if (assets.length === 0) {
  console.error(`check-runtime-bundle: no JS/CSS assets in ${DIST} (run build first)`);
  process.exit(1);
}

let failed = false;
for (const asset of assets) {
  const content = readFileSync(asset, "utf8");
  for (const needle of FORBIDDEN) {
    if (content.includes(needle)) {
      failed = true;
      console.error(`check-runtime-bundle: forbidden string "${needle}" found in ${asset}`);
    }
  }
}

if (failed) {
  console.error(
    "check-runtime-bundle: the runtime bundle must not contain Nova database or party secret logic.",
  );
  process.exit(1);
}
console.log(`check-runtime-bundle: clean (${assets.length} assets scanned, no forbidden strings)`);
