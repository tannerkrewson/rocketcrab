# F4 runtime sandbox — capability matrix

Status: **automated desktop results committed** (2026-08-01). **Physical
iPhone pass completed** (2026-08-01) — see the Physical iPhone column and
`runtime-sandbox-findings.md`.

Environment (automated): headless Chromium (Playwright), SwiftShader software
WebGL, fake media devices, self-signed local HTTPS. Origins: host `:5273`,
runtime `:5274`.

Physical device: iPhone (Mobile Safari), same-Wi-Fi LAN via
`https://192.168.1.10:*` with locally-trusted self-signed certs; host UI
extended with an on-screen probe panel, a "Load infinite game" button, and an
orientation-permission button so every probe is observable on a phone with no
JS console.

| Capability (F4 list)            | Automated result                        | How verified                                                                                                                             | Physical iPhone                                                                                                                               |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline scripts                  | ✅ pass                                 | classic `<script>` ran in game frame                                                                                                     | ✅                                                                                                                                            |
| Inline ESM modules              | ✅ pass                                 | `<script type="module">` ran                                                                                                             | ✅                                                                                                                                            |
| jsDelivr ESM dependency         | ✅ pass                                 | `import('https://cdn.jsdelivr.net/npm/uuid@9.0.1/+esm')` resolved                                                                        | ✅                                                                                                                                            |
| `fetch` (remote, CORS)          | ✅ pass                                 | fetched jsDelivr `package.json`                                                                                                          | ✅                                                                                                                                            |
| Remote image                    | ✅ pass                                 | `placehold.co` image `onload`                                                                                                            | ✅                                                                                                                                            |
| Canvas 2D                       | ✅ pass                                 | fillRect + getImageData pixel check                                                                                                      | ✅ (orange canvas rendered)                                                                                                                   |
| WebGL                           | ✅ pass (software)                      | `webgl` context + `VERSION` param; needed `--enable-unsafe-swiftshader`/`--use-angle=swiftshader` headless                               | ✅ (hardware)                                                                                                                                 |
| Web Audio                       | ✅ pass (after gesture)                 | `AudioContext` suspended → `resume()` after click → `running`                                                                            | ✅ (after gesture; audible beep added)                                                                                                        |
| WebSocket                       | ✅ pass (local wss echo)                | text echo round-trip on `wss://localhost:5276`. _Public echo service (echo.websocket.events) was DNS-unreachable from this network._     | ✅ (desktop Chromium verified 2026-08-01; phone re-run pending — reload hello)                                                                |
| File input                      | ✅ pass                                 | `setInputFiles` + FileReader read-back                                                                                                   | ✅ (text file containing `HELLO-FROM-SPIKE`)                                                                                                  |
| Clipboard                       | ✅ pass (permission + gesture)          | `writeText` inside a click handler with `clipboard-write` granted + `allow` attribute                                                    | ✅                                                                                                                                            |
| Fullscreen                      | ❌ headless unsupported (informational) | `requestFullscreen` → `false`; requires headed/real browser                                                                              | ❌ iPhone Safari (platform limitation); ✅ desktop Chromium after fullscreen delegation fix (2026-08-01; Helium ❌ = browser-specific)        |
| Pointer lock                    | ❌ headless unsupported (informational) | `requestPointerLock` → `false`; requires headed/real browser                                                                             | ❌ iPhone Safari (platform limitation); ✅ desktop Chromium after allow-pointer-lock sandbox token (2026-08-01; Helium ❌ = browser-specific) |
| Camera / microphone             | ✅ pass (fake device)                   | `getUserMedia` resolved with fake video+audio when permission granted and `allow="camera; microphone"` on both iframes                   | ✅ real capture (prompt allowed; indicator appeared then stopped)                                                                             |
| Device orientation / motion     | ✅ pass (synthetic event)               | dispatched `DeviceOrientationEvent` received with values; real sensor data needs a device                                                | ❌ `requestPermission()` → `denied`, no prompt surfaced (see findings)                                                                        |
| Page suspend and resume         | ⚠️ partial                              | synthetic `visibilitychange` observed by game; real iOS backgrounding/freeze cannot be simulated                                         | ✅ backgrounding (Home 10s+ → return) recovered fine                                                                                          |
| Runtime reload                  | ✅ pass                                 | soft reload produced a clean frame (game state reset)                                                                                    | ✅                                                                                                                                            |
| Runtime destruction             | ✅ pass                                 | destroy removed the game frame; host UI intact                                                                                           | ✅ (Emergency stop)                                                                                                                           |
| CPU exhaustion / infinite loop  | ⚠️ environment-dependent                | see findings: no OOPIF in headless shell → whole tab wedges; recovery via browser-level teardown; **shell survival needs real browsers** | ❌ **FAIL** — iPhone Safari AND desktop Chromium both wedge the shell (isolation is per-site/scheme+host, not per-port); see findings         |
| Bootstrap origin validation     | ✅ pass                                 | bootstrap from unrelated origin `:5275` rejected                                                                                         | — (automated; not re-exercised on device)                                                                                                     |
| Bootstrap schema validation     | ✅ pass                                 | malformed / unknown-version messages rejected with useful errors                                                                         | — (automated; not re-exercised on device)                                                                                                     |
| Game → host DOM/storage/cookies | ✅ pass                                 | all blocked (`SecurityError`)                                                                                                            | ✅ (malicious-game row: nothing visible, no navigation)                                                                                       |
| Game → top navigation           | ✅ pass                                 | direct assignment and `target=_top` anchor blocked (sandbox, no `allow-top-navigation`)                                                  | ✅ (malicious-game row)                                                                                                                       |
| Game → emergency stop control   | ✅ pass                                 | control lives outside the frame; removal attempt blocked                                                                                 | ✅ (stop stayed live during/after malicious game)                                                                                             |
| Runtime origin holds no secrets | ✅ pass                                 | localStorage/cookies/IndexedDB empty on runtime origin                                                                                   | ✅ (DevTools: localStorage + cookies empty)                                                                                                   |

## Notes

- Permission delegation requires the `allow` attribute on **both** iframes in
  the chain: host → runtime iframe and runtime → game iframe. Fullscreen
  additionally needs `allowfullscreen` / `allow="fullscreen"` on both iframes
  and the `allow-fullscreen` sandbox token on the game frame; pointer lock
  needs the `allow-pointer-lock` sandbox token (all added 2026-08-01 after the
  desktop pass found them missing). Required reading for U3 and M2
  (Permissions-Policy on the runtime origin).
- Headless lacks a real GPU, audio output, sensors, and a display — rows
  marked informational are expected to differ on physical devices.
- Production security headers (main vs runtime origin) are M2 scope; the dev
  spike uses identical throwaway self-signed certs on both origins.
- Physical-pass tooling (2026-08-01): `gen-certs.mjs` takes a LAN IP so the
  cert covers the phone-reachable host; the hello game gained an on-screen
  probe panel, an audible beep, a WebSocket probe, and an orientation-
  permission button; the host gained a "Load infinite game" button.
