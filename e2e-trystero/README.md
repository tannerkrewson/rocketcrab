# Trystero transport e2e (P1)

Real-browser integration smoke tests for `@rocketcrab/trystero-transport`.
External-network tests, deliberately NOT part of the CI smoke run
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
  1. Two pages discover each other through real Nostr relays, exchange a
     structured message, a 256 KiB binary payload, and a 1 MiB large string
     with progress events on both sides, ping each other, then leave.
  2. Relay diagnostics + connection quality are observable after joining.
  3. P3: two pages run the game-source coordinator (packages/party) over the
     real transport — the host registers a multi-chunk game source, the
     admitted joiner requests and receives it byte-identical, and the
     SHA-256 digest + byte count verify before launch.

## Resiliency

If the external relays are unreachable, the adapter's `join()` rejects with
`relay_unreachable` (F5 finding F5 — Trystero gives no structured join error
for relay failure, so the adapter detects it itself) and the specs SKIP
instead of failing. Run these when you have network access to public Nostr
relays; expect discovery to take ~20-25 s (F5 F3).

## HTTPS

Same-machine loopback works over plain HTTP because `localhost` is a secure
context (F9). To also reach a physical phone on the LAN, drop the spike's
locally-trusted certs into `certs/` (`key.pem` + `cert.pem`, valid for
localhost + LAN IP) — the config switches to HTTPS automatically. Cert files
are gitignored.
