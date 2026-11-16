# Trystero transport e2e (P1)

Real-browser integration smoke tests for `@rocketcrab/trystero-transport`.
Local-relay tests, deliberately NOT part of the CI smoke run
(`npm run test:e2e`); run them explicitly with:

```sh
npm run test:e2e:trystero
```

## What it does

A small harness page (`src/main.ts`) drives the real `TrysteroTransport`
behind `window.__harness`. Three specs:

1. `trystero.spec.ts`: two pages discover each other through the local edge
   signaling relay, exchange structured, binary and 1 MiB messages, ping, and
   leave; relay diagnostics and connection quality are observable.
2. `game-source.spec.ts`: the game-source coordinator (`packages/party`)
   transfers a multi-chunk game source that verifies by SHA-256.
3. `tunnel-fallback.spec.ts`: a pair whose WebRTC is forced off moves to the
   edge tunnel, carries a 2 MiB source intact, and tears down cleanly, while a
   healthy pair stays on WebRTC.

## Local relay

Playwright starts the local edge Worker on port 18787. Signaling failures fail
the tests; they are never skipped when the relay is unreachable.

## HTTPS

Same-machine loopback works over plain HTTP because `localhost` is a secure
context (F9). To also reach a physical phone on the LAN, drop the spike's
locally-trusted certs into `certs/` (`key.pem` + `cert.pem`, valid for
localhost + LAN IP) — the config switches to HTTPS automatically. Cert files
are gitignored.
