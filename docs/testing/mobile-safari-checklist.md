# M1 — Mobile Safari physical-device verification checklist

Status: **pending — run at release validation (M4)**. This is a human pass
on **physical iPhones** (Mobile Safari); Playwright WebKit is a CI
supplement, never a substitute (engineering rule 17, ADR-0012). Automated
equivalents that already run in CI are listed per scenario so the human pass
concentrates on what only a real phone can prove.

Owner: M1 (rocketcrab-9fv.6.1) → handed to M4 (rocketcrab-9fv.6.4).

## Prerequisites

- Two+ physical iPhones (one is enough for the solo scenarios; the
  party/authority scenarios need two) and a laptop on the **same Wi-Fi** as
  the Nova host. Mobile Safari is the target browser.
- Local HTTPS with the LAN IP trusted: `node scripts/gen-certs.mjs <LAN IP>`
  then `npm run dev:https` (nova `https://<LAN IP>:5173`, runtime origin
  `https://<LAN IP>:5174`); install the throwaway cert on each phone
  (`https://<LAN IP>:5174` first, then the app origin).
- A game to play: `examples/games/nova-quiz.html` (Nova Quiz, state mode) is
  the reference game — paste it into Create, save it, and use it for every
  scenario.
- Low Power Mode: enable on one phone via Settings → Battery (practical
  where the device allows).

## How to read this checklist

Each row: the scenario (from the M1 issue), the minimal physical steps, the
expected result on a phone, and the automated CI coverage that backs it.
Record pass/fail/notes in the results table at the end; a scenario only
passes when its expected result holds **on the phone**.

---

## A. Layout and viewport (portrait + landscape, dynamic chrome, safe areas)

| #   | Scenario                       | Steps (physical iPhone)                                                                                                             | Expected result                                                                                                                                                                                                                                                         | CI equivalent                                      |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A1  | Portrait + landscape           | Open `/party` lobby, the editor + test arena `/editor`, and the editor `/games/:id/edit` in portrait; rotate to landscape and back. | No clipped controls, no horizontal scroll, content reflows; the sticky header and bottom nav stay reachable; nothing is cut off by the URL bar or home indicator.                                                                                                       | WebKit viewport smoke tests (editor/arena layouts) |
| A2  | Dynamic browser chrome         | Scroll down and up with the URL bar collapsing/expanding while the party lobby and the play shell are on screen.                    | No layout jump that hides the party code, the Start button, or the play-shell controls; fixed fullscreen frame stays fullscreen (no gap at bottom); no control ends up under the home indicator.                                                                        | none (real chrome only)                            |
| A3  | Safe-area insets               | With the phone in landscape (notch/home indicator side), check the header, bottom nav, play-shell overlay, and editor footer.       | Content is padded inside the notch and home-indicator regions (`pt-safe` / `pb-safe`); buttons are tappable; nothing sits under the indicator.                                                                                                                          | none (real insets only)                            |
| A4  | On-screen keyboard             | In the editor, tap the code pane and type; in `/join`, type a four-letter code.                                                     | The keyboard pushes/resizes the layout without hiding the focused field or the Run/Stop controls; `100vh`-based panels keep a usable minimum height (the app uses `vh` + `min-h` guards); the page zooms only on deliberate pinch (no iOS auto-zoom on focused inputs). | editor Playwright tests (desktop)                  |
| A5  | Large touch-only game controls | Play Nova Quiz fully on the phone with no keyboard/pointer.                                                                         | Every button is ≥ ~44 px tall, works on first tap, and the whole game is playable touch-only (no hover, no keyboard, no right-click anywhere in the flow).                                                                                                              | example-game contract tests; arena e2e             |

## B. Permissions and media (audio gesture, camera/mic)

| #   | Scenario                             | Steps (physical iPhone)                                                                                                         | Expected result                                                                                                                                                                                                     | CI equivalent                                             |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| B1  | Audio start after user gesture       | Run a game that plays a beep (or add `new AudioContext()` + `resume()` on a tap). Open it in the editor preview and in a party. | The first audible sound happens only **after** a user gesture (tap); before any gesture the AudioContext is suspended, no sound plays, and no error breaks the game. A second tap plays sound again after a reload. | runtime Web Audio tests (headless, after gesture)         |
| B2  | Audio startup instructions are clear | Read the game-author guidance in `docs/api/nova-api.md` (Mobile Safari notes) and the editor preview help.                      | The instructions say audio needs a user gesture, show the `resume()` pattern, and mention iOS silent-switch behavior; a game author can find them.                                                                  | docs review                                               |
| B3  | Camera/mic permission                | Run a game calling `getUserMedia({ video: true })` in a party on the phone.                                                     | Safari prompts for camera access; allowing it shows the capture indicator; the prompt appears (delegation reaches the game frame); denying shows a clear `NotAllowedError` to the game.                             | F4 matrix (device pass ✅); media tests with fake devices |
| B4  | Permission denial                    | Deny camera permission, then call `getUserMedia` again.                                                                         | The game receives a structured failure it can surface; the shell keeps working; re-requesting after Settings → Safari → Camera reset prompts again.                                                                 | F4 matrix                                                 |

## C. Lifecycle (rotation, lock/unlock, backgrounding, tab switching, freeze)

| #   | Scenario                         | Steps (physical iPhone)                                                                                     | Expected result                                                                                                                                                                                                                                                        | CI equivalent                                                        |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| C1  | Device rotation                  | Rotate during a game in the arena and during a party game mid-round.                                        | Game frame and shell reflow; the game keeps running; no stuck layout; state is unaffected (round continues).                                                                                                                                                           | arena e2e (headless rotation not simulated)                          |
| C2  | Lock/unlock                      | Lock the phone mid-party (lobby and mid-game), wait ≥ 10 s, unlock.                                         | On return the shell detects the suspended connection, shows the reconnect screen with progress (attempt counter + auto-retry), reconnects automatically or via one tap, and the lobby/game state is current. Timers did **not** advance while locked (no desync).      | M1 unit tests (fake lifecycle + fake timers)                         |
| C3  | Home-screen backgrounding        | Press Home mid-game, use other apps for ~20–60 s, return via the app switcher.                              | Same as C2: reconnect screen → clean rejoin; the game resumes at the current round (catch-up snapshot), no stuck "connected but silent" state.                                                                                                                         | M1 engine tests (suspend/resume + F11 probe); S4 physical step 10/13 |
| C4  | Tab switching                    | With a second tab open, switch away and back several times during a party game.                             | Same recovery as C2/C3; the party code and invite link still work for late joiners while the phone is away.                                                                                                                                                            | M1 engine tests                                                      |
| C5  | Page freeze + restore            | In Safari, background the tab (another app), then return; force a reload from the tab bar while in a party. | **Freeze/restore**: recovers like C2. **Reload**: the page reloads, the party route/join route shows the "Return to your party" banner (recovery record), and one tap rejoins the live party with the same member identity; the game source re-fetches from the party. | M1 recovery-record tests; resume-banner route tests                  |
| C6  | Low-power mode (where practical) | Enable Low Power Mode, then repeat C2/C3.                                                                   | Same recovery; no additional errors; the shell does not assume timers ran while backgrounded.                                                                                                                                                                          | none (device only)                                                   |

## D. Network (switches, offline)

| #   | Scenario                | Steps (physical iPhone)                                                        | Expected result                                                                                                                                                                                                                                                                                                                                | CI equivalent                                         |
| --- | ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| D1  | Wi-Fi ⇄ cellular switch | In a party game, turn off Wi-Fi (phone falls to cellular), wait, rejoin Wi-Fi. | The shell surfaces the loss (reconnect screen or offline notice), auto-reconnects when the network returns (`online` event), and the player catches up with current state. **Note:** cross-network WebRTC needs TURN (P0 rocketcrab-23s) — same-party peers on Wi-Fi are fine; record failures separately if the party was on another network. | M1 offline/online unit tests; trystero findings F5/S3 |
| D2  | Temporary offline       | Enable Airplane Mode mid-party, wait ~30 s, disable it.                        | While offline: clear "You're offline — Nova will reconnect when the network returns" and an emergency Leave. After restoring: auto-reconnect within the backoff window (5–30 s) with visible attempt progress; lobby/game state current.                                                                                                       | M1 offline/online tests; F5 scenario 11 findings      |

## E. Roles and recovery (authority suspension, greeter suspension, reload)

| #   | Scenario                   | Steps (physical iPhone)                                                                                                                              | Expected result                                                                                                                                                                                           | CI equivalent                                                              |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| E1  | Authority suspension       | With Nova Quiz in a round, background **the phone holding authority** (the arena shows the Authority badge; in a real party it is the first player). | Remaining phones keep playing with no error: the round reveals, scores update, the next round starts (S3 election migrates authority; suspended authority is replaceable).                                | S4 e2e (arena authority suspend); S3 election tests; M1 playing-phone test |
| E2  | Greeter suspension         | Background the **greeter** phone (the party creator with the four-letter code) while another player is mid-party.                                    | The greeter role migrates to the next member; a late joiner can still join by code/invite while the greeter is away; on return the greeter steps down cleanly (no duplicate advertisers, F11).            | rendezvous greeter-migration tests                                         |
| E3  | Reconnect after reload     | While in a party, reload the phone's page.                                                                                                           | The recovery banner appears on `/party` or `/join`; one tap rejoins the same party (same memberId); the game re-registers and the current state catches up; the four-letter code still joins new players. | M1 recovery tests; resume-banner route tests                               |
| E4  | Emergency exit everywhere  | From the reconnect screen and the lobby, use Leave / End-game-for-everyone (the in-game menu has no leave button since 9fv.11.11 — exit happens from the lobby).                                                         | Every control works on the phone, always reachable (never inside the game frame), and ends/leaves cleanly for everyone.                                                                                   | P4 play-shell tests; engine cleanup tests                                  |
| E5  | Reconnect progress visible | Background/offline a phone and watch the reconnect screen.                                                                                           | The screen shows "Connection lost", the attempt number, auto-retry status, and Reconnect now / Leave party. It never sits silently.                                                                       | M1 reconnect-screen tests                                                  |

## F. Persistence and multi-frame

| #   | Scenario                                 | Steps (physical iPhone)                                                              | Expected result                                                                                                                                | CI equivalent                                  |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| F1  | IndexedDB persistence                    | Save a game in the editor, reload the page, open the library, reopen the game.       | The saved game (source + metadata) survives the reload (IndexedDB on the main origin).                                                         | games db tests (fake-indexeddb)                |
| F2  | Several simultaneous test frames         | In the test arena (on `/editor`), run Nova Quiz with 4 players at once on the phone. | All four frames boot, register, and stay responsive; controls remain tappable; suspending/resuming one player does not disturb the others.     | arena e2e (4 frames, headless); F4 device pass |
| F3  | Runtime frame survives party transitions | Create a party, go lobby → play → end → lobby again on the phone.                    | The game frame keeps running through transitions (never remounted/restarted mid-party); the play shell and its emergency controls stay on top. | P4 engine tests (frame lifecycle)              |

---

## Results table (fill in at M4)

| Scenario                       | Result (PASS/FAIL/N/A) | Notes |
| ------------------------------ | ---------------------- | ----- |
| A1 portrait + landscape        |                        |       |
| A2 dynamic browser chrome      |                        |       |
| A3 safe-area insets            |                        |       |
| A4 on-screen keyboard          |                        |       |
| A5 large touch-only controls   |                        |       |
| B1 audio after user gesture    |                        |       |
| B2 audio instructions clear    |                        |       |
| B3 camera/mic permission       |                        |       |
| B4 permission denial           |                        |       |
| C1 device rotation             |                        |       |
| C2 lock/unlock                 |                        |       |
| C3 home-screen backgrounding   |                        |       |
| C4 tab switching               |                        |       |
| C5 page freeze + restore       |                        |       |
| C6 low-power mode              |                        |       |
| D1 Wi-Fi ⇄ cellular            |                        |       |
| D2 temporary offline           |                        |       |
| E1 authority suspension        |                        |       |
| E2 greeter suspension          |                        |       |
| E3 reconnect after reload      |                        |       |
| E4 emergency exit              |                        |       |
| E5 reconnect progress          |                        |       |
| F1 IndexedDB persistence       |                        |       |
| F2 several simultaneous frames |                        |       |
| F3 runtime frame transitions   |                        |       |

## Acceptance-criteria mapping

| M1 acceptance criterion                                                  | Where it is proven                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| State-mode vertical slice survives authority-phone backgrounding         | E1 + S4 e2e (arena suspend) + M1 "playing phone" unit test               |
| A resumed player rejoins with current state                              | C2/C3/C5/E3 + M1 catch-up/reconnect tests                                |
| No desktop-only controls are required                                    | A5 + UI review (touch targets, no hover/keyboard-only paths)             |
| Test arena controls remain usable on a phone                             | A5/F2                                                                    |
| Audio startup instructions are clear                                     | B2 + `docs/api/nova-api.md` Mobile Safari notes                          |
| Compatibility limitations are documented                                 | This checklist + `docs/architecture/adr-0012-*` + `docs/api/nova-api.md` |
| Playwright WebKit tests supplemented by documented physical-device tests | This document (the human pass) alongside the WebKit/Playwright suites    |

## Known compatibility limitations (document, do not hide)

- **Fullscreen and pointer lock are unsupported on iPhone Safari** (platform
  limitation, F4). Games must not require them; `requestFullscreen` fails
  cleanly.
- **Device orientation/motion permission is denied inside the sandboxed
  game frame** (F4): iOS never surfaces the prompt for the cross-origin
  sandboxed iframe. Games that need tilt controls are unsupported in this
  build.
- **CPU exhaustion wedges the whole tab** (B6, F4): an infinite-loop game
  freezes Safari including the shell (isolation is per-site; a unique
  runtime subdomain is the deferred fix, M2). Recovery is browser-level
  (reload); the runtime session survives finite heavy bursts. Games are
  validated at the size/rate boundaries (15/21) to reduce risk.
- **Cross-network phone-to-phone connectivity requires TURN** (F5 S3, P0
  rocketcrab-23s): same-Wi-Fi parties work without it; record any
  cross-network failures in D1 separately.
- **Timers do not run while backgrounded** (B6): the shell never assumes
  they do — heartbeats pause, reconnect is event-driven (visibility/
  online), and the reconnect screen shows progress instead of guessing.
