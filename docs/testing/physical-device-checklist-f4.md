# F4 physical-device checklist (human pass)

This checklist completes the F4 acceptance criteria that cannot be automated:
**a physical iPhone** (plus one desktop browser as a control). Run the spike,
then work through the matrix. Record pass/fail/notes and report back so F4 can
be closed.

## Prerequisites

1. The spike is committed at `spikes/runtime-sandbox/` in the worktree.
2. The dev machine and the iPhone are on the **same Wi-Fi**.
3. Start the spike servers on the dev machine:

   ```sh
   cd spikes/runtime-sandbox
   npm install        # first time
   npm run dev        # host :5273, runtime :5274, evil :5275 (all HTTPS)
   ```

4. Find the dev machine's LAN IP: `hostname -I` (Linux) or
   `ipconfig getifaddr en0` (macOS). Note it as `IP`.

## Phone setup (iPhone, Mobile Safari)

- Open `https://IP:5273` in Safari.
- Expect a **self-signed certificate warning** — accept it
  ("Show Details" → "visit this website"). A second warning may appear for the
  runtime origin assets; accept that too.
- Safari blocks some APIs on first use; each permission prompt should be
  **allowed** (camera, microphone, clipboard) — that is part of the test.

## Desktop control (one desktop browser: Chrome, Safari, or Firefox)

Repeat the matrix rows below on the desktop (same URLs). Desktop is the
control against the headless automated results.

## Test matrix

For each row: run the test, record ✅ / ❌ / ⚠️ (partial) + notes.

| #   | Test                           | How                                                                                                                                                                                        | iPhone | Desktop |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- |
| 1   | **Launch a pasted game**       | Tap **Load hello game**. Canvas should render orange, image loads, "inline script ran: yes"                                                                                                |        |         |
| 2   | **Inline + remote ESM**        | hello game auto-loads `uuid` from jsDelivr (probe runs silently — no error toast)                                                                                                          |        |         |
| 3   | **fetch**                      | hello game fetches a remote JSON (silent probe)                                                                                                                                            |        |         |
| 4   | **Canvas + WebGL**             | hello game draws 2D canvas and creates a WebGL context (watch for an error toast)                                                                                                          |        |         |
| 5   | **Audio after gesture**        | Tap **tap for audio…** — audio should start (or `AudioContext` resume) only after the tap                                                                                                  |        |         |
| 6   | **Camera/mic**                 | hello game requests camera+mic; allow the prompt; check the red recording indicator appears then stops                                                                                     |        |         |
| 7   | **File input**                 | Tap the **Choose File** control, pick a small text file                                                                                                                                    |        |         |
| 8   | **Clipboard**                  | Tap **tap for audio…** (also runs clipboard write); no clipboard error toast                                                                                                               |        |         |
| 9   | **Fullscreen**                 | Tap **tap for audio…** → game canvas should go fullscreen                                                                                                                                  |        |         |
| 10  | **Pointer lock**               | Same button (if Safari supports it on this device)                                                                                                                                         |        |         |
| 11  | **Device orientation**         | Rotate the phone — the game should see `deviceorientation` events                                                                                                                          |        |         |
| 12  | **Reload (soft)**              | Tap **Reload game (soft)** — the game resets cleanly                                                                                                                                       |        |         |
| 13  | **Destroy**                    | Tap **🛑 Emergency stop** — the frame is removed; the page is still usable; **Load hello game** works again                                                                                |        |         |
| 14  | **Malicious game**             | Tap **Load malicious game** — nothing visible should happen; the tab does **not** navigate; **Emergency stop still works**                                                                 |        |         |
| 15  | **CPU-exhaustion containment** | In the editor, load `fixtures/infinite.html` (a game that loops forever after ~4s). **The Nova shell must stay responsive and Emergency stop must work** (real-browser process isolation). |        |         |
| 16  | **Backgrounding**              | With hello game running, press Home, wait 10s, return to Safari — the game should resume (or rejoin state without a broken frame)                                                          |        |         |
| 17  | **Runtime origin secrets**     | After a session, confirm the runtime origin (`https://IP:5274`) has no stored secrets (hard to inspect on phone — desktop control does this via DevTools)                                  |        |         |
| 18  | **Orientation/rotation**       | Rotate portrait ↔ landscape mid-game — layout must not break                                                                                                                               |        |         |

## What to report back

- Pass/fail per row (iPhone + desktop), any error messages from the host log
  panel or Safari console.
- Row 15 specifically: did the Nova shell stay responsive while the game
  spun? Could Emergency stop recover it?
- Row 16: did the suspended game recover on return?
- Anything that contradicts the automated results in
  `runtime-sandbox-capability-matrix.md`.

These results close F4 (and update ADR-0001/0008/0012), unblock F6, U3, A3,
and M1, and feed B1/B5/B6 in the blocker register.
