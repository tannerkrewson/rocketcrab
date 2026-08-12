#!/usr/bin/env node
/**
 * Static-deploy verification (M2; docs/architecture/deployment.md).
 *
 * Checks a built origin's dist output against the deployment requirements
 * before it is published. Runs in the GitHub Pages deploy workflow after
 * `vite build` and locally via `npm run verify:deploy`. Exit code 0 keeps
 * the deploy going; a non-zero exit aborts it.
 *
 * Nova origin (strict main-origin policy):
 *   - index.html carries the build-time CSP meta tag (GitHub Pages cannot
 *     send custom response headers) with `frame-src` pinned to the
 *     configured runtime origin;
 *   - no inline application scripts (`script-src 'self'` must hold);
 *   - 404.html exists and is byte-identical to index.html (GitHub Pages
 *     SPA fallback — reloading any route works);
 *   - the referrer meta tag is present (no path/query leakage; invite
 *     secrets already live in URL fragments, ADR-0011).
 *
 * Runtime origin (permissive policy, compensating controls):
 *   - NO CSP meta (game HTML keeps ordinary web capabilities);
 *   - the referrer meta tag is present;
 *   - the bundle registers no service worker (no persistent network
 *     control over game traffic, ADR-0008).
 *
 * Usage:
 *   node scripts/verify-static-deploy.mjs --origin nova|runtime [--runtime-origin <origin>]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const origin = args.origin;
const runtimeOrigin = args.runtimeOrigin ?? "";
if (origin !== "nova" && origin !== "runtime") {
  fail(`--origin must be "nova" or "runtime" (got "${origin}")`);
}

const DIST = fileURLToPath(new URL(`../apps/${origin}/dist`, import.meta.url));
const indexHtml = readFile(join(DIST, "index.html"), `${origin} index.html`);
const errors = [];

/** Record a check result and remember failures (exit non-zero at the end). */
function expect(description, condition, detail = "") {
  console.log(`${condition ? "ok" : "FAIL"}  ${description}${detail ? `: ${detail}` : ""}`);
  if (!condition) {
    errors.push(description);
  }
}

if (origin === "nova") {
  // Strict main-origin policy: CSP delivered as a build-time meta tag.
  const cspMatch = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i.exec(indexHtml);
  expect("CSP meta tag present", cspMatch !== null);
  if (cspMatch !== null) {
    const contentMatch = /content="([^"]*)"/i.exec(cspMatch[0]);
    const csp = decodeHtmlEntities(contentMatch?.[1] ?? "");
    if (runtimeOrigin === "") {
      expect(
        "runtime origin supplied for a nova deploy",
        false,
        "pass --runtime-origin (the workflow input) — it is baked into the CSP frame-src",
      );
    } else {
      const normalized = new URL(runtimeOrigin).origin;
      expect(
        "CSP frame-src is the configured runtime origin",
        csp.includes(`frame-src ${normalized}`),
        `expected frame-src ${normalized}`,
      );
    }
    const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
    expect("CSP script-src allows only 'self'", /^'self'$/.test(scriptSrc.trim()));
    expect(
      "CSP has no 'unsafe-inline'/'unsafe-eval' for scripts",
      !/unsafe-inline|unsafe-eval/.test(scriptSrc),
    );
  }
  const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>/i.exec(indexHtml);
  expect("no inline application scripts", inlineScript === null, inlineScript?.[0] ?? "");
  // GitHub Pages SPA fallback: 404.html serves the shell for unknown paths.
  const notFound = readFileOptional(join(DIST, "404.html"));
  expect("404.html present (GitHub Pages SPA fallback)", notFound !== null);
  if (notFound !== null) {
    expect("404.html is a byte-copy of index.html", notFound === indexHtml);
  }
  expect("referrer meta (no-referrer)", isNoReferrerMeta(indexHtml));
} else {
  // Runtime origin: intentionally permissive — no CSP, no service workers.
  expect(
    "runtime has NO CSP meta (permissive by design)",
    !/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i.test(indexHtml),
  );
  expect("referrer meta (no-referrer)", isNoReferrerMeta(indexHtml));
  const swHits = scanForServiceWorker(DIST);
  expect("no service worker registration in the bundle", swHits.length === 0, swHits.join(", "));
}

if (errors.length > 0) {
  console.error(
    `\nverify-static-deploy: ${errors.length} check(s) failed for the ${origin} origin`,
  );
  process.exit(1);
}
console.log(`\nverify-static-deploy: ${origin} origin OK`);

function isNoReferrerMeta(html) {
  return /<meta[^>]*name="referrer"[^>]*content="no-referrer"/i.test(html);
}

/** Decode the numeric/entity escapes Vite emits inside HTML attributes. */
function decodeHtmlEntities(value) {
  return value
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function scanForServiceWorker(dist) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        entry.endsWith(".js") &&
        /serviceWorker\.register/.test(readFileSync(full, "utf8"))
      ) {
        hits.push(entry);
      }
    }
  };
  walk(dist);
  return hits;
}

function readFile(file, label) {
  if (!existsSync(file)) {
    fail(`${label} missing: ${file}`);
  }
  return readFileSync(file, "utf8");
}

function readFileOptional(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function fail(message) {
  console.error(`verify-static-deploy: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--origin" || arg === "--runtime-origin") {
      out[arg === "--origin" ? "origin" : "runtimeOrigin"] = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return out;
}
