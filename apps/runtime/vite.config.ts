import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin, type Rolldown } from "vite";

// Local HTTPS dev certs (scripts/gen-certs.mjs) — same mechanism as the
// nova app (apps/nova/vite.config.ts). `npm run dev:https` starts the dev
// server with `--mode https`; plain `npm run dev` stays on HTTP.
const CERT_DIR = fileURLToPath(new URL("../../.certs", import.meta.url));
const CERT = join(CERT_DIR, "localhost-cert.pem");
const KEY = join(CERT_DIR, "localhost-key.pem");

/** Vite `server.https` config in `https` mode; `undefined` (plain HTTP) otherwise. */
function httpsServerConfig(mode: string) {
  if (mode !== "https") {
    return undefined;
  }
  if (!existsSync(CERT) || !existsSync(KEY)) {
    throw new Error(
      "Local HTTPS certs are missing. Run `npm run gen-certs` first (see docs/architecture/deployment.md).",
    );
  }
  return { key: KEY, cert: CERT };
}

function runtimeHeaders(): Plugin {
  return {
    name: "runtime-headers",
    apply: "build",
    generateBundle() {
      const rawOrigin = process.env.VITE_MAIN_ORIGIN?.trim() ?? "";
      const mainOrigin = rawOrigin === "" ? "'none'" : new URL(rawOrigin).origin;
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cross-Origin-Opener-Policy: same-origin\n  Permissions-Policy: camera=(self), microphone=(self), clipboard-read=(self), clipboard-write=(self), fullscreen=(self)\n  Content-Security-Policy: default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors ${mainOrigin}; object-src 'none'; base-uri 'self'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
    },
  };
}

const FRAME_SCRIPT_ID = "virtual:nova-frame-script";
const FRAME_ENTRY = fileURLToPath(new URL("./src/frame/entry.ts", import.meta.url));

/**
 * `import script from "virtual:nova-frame-script"` gives the game-frame script
 * (src/frame/entry.ts and the tested `@rocketcrab/nova-api` client it uses),
 * bundled to one minified IIFE string that the runtime inlines ahead of each
 * game. `</script` is escaped so the string is safe inside a script element.
 */
export function novaFrameScript(): Plugin {
  return {
    name: "nova-frame-script",
    resolveId: (id) => (id === FRAME_SCRIPT_ID ? `\0${FRAME_SCRIPT_ID}` : undefined),
    async load(id) {
      if (id !== `\0${FRAME_SCRIPT_ID}`) return undefined;
      const result = (await build({
        configFile: false,
        logLevel: "silent",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
          write: false,
          minify: true,
          lib: { entry: FRAME_ENTRY, formats: ["iife"], name: "novaFrame" },
        },
      })) as Rolldown.RolldownOutput[];
      const chunk = result[0]!.output[0];
      for (const file of chunk.moduleIds) if (!file.startsWith("\0")) this.addWatchFile(file);
      const code = chunk.code.replace(/<\/script/gi, "<\\/script");
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

// Static origin for the isolated game runtime.
// In production this is deployed to a separate origin (runtime.nova.example).
// The dev server listens on a distinct port so both origins run locally.
// Intentionally NO CSP meta: the runtime page must keep ordinary web
// capabilities for game HTML (permissive runtime policy — compensated by the
// separate origin, secret-free content, no service workers, and the strict
// main-origin policy; docs/architecture/deployment.md).
export default defineConfig(({ mode }) => ({
  plugins: [novaFrameScript(), runtimeHeaders()],
  server: {
    port: 5174,
    https: httpsServerConfig(mode),
  },
}));
