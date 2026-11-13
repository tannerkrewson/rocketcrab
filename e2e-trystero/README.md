# Trystero transport e2e (P1)

Real-browser integration smoke tests for `@rocketcrab/trystero-transport`.
Local-relay tests, deliberately NOT part of the CI smoke run
(`npm run test:e2e`); run them explicitly with:

```sh
npm run test:e2e:trystero
```

## What it does

- Serves a small harness page (`src/main.ts`) that drives the REAL adapter
  (`TrysteroTransport` — the P1 deliverable) behind a `window.__harness`,
  exactly like the F5 spike driver did for raw Trystero.
- Two specs, modeled on the F5 spike's Playwright approach (vite dev server,
  multiple pages in one Chromium, HTTPS + `ignoreHTTPSErrors` when locally
  trusted certs are present at `certs/key.pem` + `certs/cert.pem`):
  1. Two pages discover each other through the local edge signaling relay, exchange a
     structured message, a 256 KiB binary payload, and a 1 MiB large string
     with progress events on both sides, ping each other, then leave.
  2. Relay diagnostics + connection quality are observable after joining.
  3. P3: two pages run the game-source coordinator (packages/party) over the
     real transport — the host registers a multi-chunk game source, the
     admitted joiner requests and receives it byte-identical, and the
     SHA-256 digest + byte count verify before launch.

## Local relay

Playwright starts the local edge Worker on port 18787. Signaling failures fail
the tests; they are never skipped when the relay is unreachable.

## HTTPS

Same-machine loopback works over plain HTTP because `localhost` is a secure
context (F9). To also reach a physical phone on the LAN, drop the spike's
locally-trusted certs into `certs/` (`key.pem` + `cert.pem`, valid for
localhost + LAN IP) — the config switches to HTTPS automatically. Cert files
are gitignored.
