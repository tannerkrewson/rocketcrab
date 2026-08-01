# F4 runtime sandbox — capability matrix

Status: **automated desktop results committed** (2026-08-01). The **physical
iPhone** column is **PENDING** — run
`docs/testing/physical-device-checklist-f4.md` and fill it in.

Environment: headless Chromium (Playwright), SwiftShader software WebGL, fake
media devices, self-signed local HTTPS. Origins: host `:5273`, runtime `:5274`.

| Capability (F4 list)            | Automated result                        | How verified                                                                                                                             | Physical iPhone             |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Inline scripts                  | ✅ pass                                 | classic `<script>` ran in game frame                                                                                                     | PENDING                     |
| Inline ESM modules              | ✅ pass                                 | `<script type="module">` ran                                                                                                             | PENDING                     |
| jsDelivr ESM dependency         | ✅ pass                                 | `import('https://cdn.jsdelivr.net/npm/uuid@9.0.1/+esm')` resolved                                                                        | PENDING                     |
| `fetch` (remote, CORS)          | ✅ pass                                 | fetched jsDelivr `package.json`                                                                                                          | PENDING                     |
| Remote image                    | ✅ pass                                 | `placehold.co` image `onload`                                                                                                            | PENDING                     |
| Canvas 2D                       | ✅ pass                                 | fillRect + getImageData pixel check                                                                                                      | PENDING                     |
| WebGL                           | ✅ pass (software)                      | `webgl` context + `VERSION` param; needed `--enable-unsafe-swiftshader`/`--use-angle=swiftshader` headless                               | PENDING (hardware)          |
| Web Audio                       | ✅ pass (after gesture)                 | `AudioContext` suspended → `resume()` after click → `running`                                                                            | PENDING                     |
| WebSocket                       | ✅ pass (local wss echo)                | text echo round-trip on `wss://localhost:5276`. _Public echo service (echo.websocket.events) was DNS-unreachable from this network._     | PENDING (real network)      |
| File input                      | ✅ pass                                 | `setInputFiles` + FileReader read-back                                                                                                   | PENDING                     |
| Clipboard                       | ✅ pass (permission + gesture)          | `writeText` inside a click handler with `clipboard-write` granted + `allow` attribute                                                    | PENDING                     |
| Fullscreen                      | ❌ headless unsupported (informational) | `requestFullscreen` → `false`; requires headed/real browser                                                                              | PENDING (critical to check) |
| Pointer lock                    | ❌ headless unsupported (informational) | `requestPointerLock` → `false`; requires headed/real browser                                                                             | PENDING (where supported)   |
| Camera / microphone             | ✅ pass (fake device)                   | `getUserMedia` resolved with fake video+audio when permission granted and `allow="camera; microphone"` on both iframes                   | PENDING (real capture)      |
| Device orientation / motion     | ✅ pass (synthetic event)               | dispatched `DeviceOrientationEvent` received with values; real sensor data needs a device                                                | PENDING (real sensor)       |
| Page suspend and resume         | ⚠️ partial                              | synthetic `visibilitychange` observed by game; real iOS backgrounding/freeze cannot be simulated                                         | PENDING (critical to check) |
| Runtime reload                  | ✅ pass                                 | soft reload produced a clean frame (game state reset)                                                                                    | PENDING                     |
| Runtime destruction             | ✅ pass                                 | destroy removed the game frame; host UI intact                                                                                           | PENDING                     |
| CPU exhaustion / infinite loop  | ⚠️ environment-dependent                | see findings: no OOPIF in headless shell → whole tab wedges; recovery via browser-level teardown; **shell survival needs real browsers** | PENDING (critical to check) |
| Bootstrap origin validation     | ✅ pass                                 | bootstrap from unrelated origin `:5275` rejected                                                                                         | PENDING                     |
| Bootstrap schema validation     | ✅ pass                                 | malformed / unknown-version messages rejected with useful errors                                                                         | PENDING                     |
| Game → host DOM/storage/cookies | ✅ pass                                 | all blocked (`SecurityError`)                                                                                                            | PENDING                     |
| Game → top navigation           | ✅ pass                                 | direct assignment and `target=_top` anchor blocked (sandbox, no `allow-top-navigation`)                                                  | PENDING                     |
| Game → emergency stop control   | ✅ pass                                 | control lives outside the frame; removal attempt blocked                                                                                 | PENDING                     |
| Runtime origin holds no secrets | ✅ pass                                 | localStorage/cookies/IndexedDB empty on runtime origin                                                                                   | PENDING                     |

## Notes

- Permission delegation requires the `allow` attribute on **both** iframes in
  the chain: host → runtime iframe and runtime → game iframe. This is
  required reading for U3 and M2 (Permissions-Policy on the runtime origin).
- Headless lacks a real GPU, audio output, sensors, and a display — rows
  marked informational are expected to differ on physical devices.
- Production security headers (main vs runtime origin) are M2 scope; the dev
  spike uses identical throwaway self-signed certs on both origins.
