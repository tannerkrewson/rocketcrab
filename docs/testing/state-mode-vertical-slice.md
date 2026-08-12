# S4 — State-mode vertical slice: verification and the 14-step flow

Status: **automated verification green** (2026-08-12). Physical-phone steps
(6, 10, 13) require real devices and are listed below as a human checklist —
run them at release validation (M4) with two+ phones on the same LAN/Wi-Fi.

The backendless state-mode MVP milestone: one complete example game
(`examples/games/nova-quiz.html` — "Nova Quiz", a round-based trivia
face-off) proves the whole create → play → migrate → reconnect workflow
with no Nova backend. Nova owns state, ordering, per-player views,
authority election, and migration; the game file contains no networking and
no direct peer-to-peer transport usage.

## What Nova Quiz exercises

| Requirement (issue)          | Where                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Three or more players        | join window requires ≥3 players (or a 15 s timeout)                                                                  |
| Public state                 | question, phase, round, scores, revealed answers                                                                     |
| Private player views         | `selectView`: own answer only pre-reveal; correct choice hidden from EVERYONE (including the authority) until reveal |
| Turn / round progression     | quizmaster rotation; rounds = roster size                                                                            |
| Reconnect                    | reconnecting player receives the current view (S2 catch-up)                                                          |
| Late join / spectator        | mid-question joiners spectate; they play from the next round                                                         |
| Authority migration          | suspending/backgrounding the authority phone re-elects (ADR-0007); the game continues                                |
| Mobile-first interface       | single column, ≥52 px touch targets, system font, safe-area insets                                                   |
| No direct peer-to-peer usage | the file only calls `nova.*`                                                                                         |

## Automated verification (already green)

Run everything from the repo root. `npm run check` covers format, lint,
typecheck, all workspace tests, and the build.

1. **In-process game suite** — `packages/nova-api/src/example-game.test.ts`
   executes the game's exact inline script against four real session-backed
   `nova` clients over the in-memory transport: full rounds, private-view
   invariants, stale-revision race handling, authority migration mid-game,
   reconnect catch-up, and late-join spectating.

   ```sh
   npx vitest run --workspace @rocketcrab/nova-api src/example-game.test.ts
   ```

2. **Party flow with the example game** — `apps/nova/src/lib/party/engine.test.ts`
   ("the S4 example game over the party flow"): create a party from the
   example document, join by code, transfer, start, play shell, end, lobby
   return — over the in-memory transport (P4/P3 path).

   ```sh
   npx vitest run --workspace @rocketcrab/nova e2e 2>/dev/null; npx vitest run --workspace @rocketcrab/nova src/lib/party/engine.test.ts
   ```

3. **Real-browser arena** — `e2e/arena-s4.spec.ts` (Playwright): four real
   runtime frames play Nova Quiz in the U6 arena; the quizmaster drives
   rounds; the authority player is suspended (simulated backgrounded phone),
   the elected authority moves, the game continues, the suspended player
   resumes and catches up. This is the automated version of steps 1–5, 7–9,
   11–12, 14.

   ```sh
   npm run test:e2e
   ```

4. **Real Trystero path** (external relays; can be flaky — see
   `e2e-trystero/README.md`): the party game-source transfer over real
   relays, byte-identical and verified.

   ```sh
   npm run test:e2e:trystero
   ```

Screenshots of the arena run live in
`docs/testing/screenshots/` (`arena-round-1.png`,
`arena-round-1-revealed.png`, `arena-authority-suspended.png`,
`arena-reconnected-caught-up.png`, `arena-round-3.png`). Regenerate with
`CAPTURE_S4_SCREENSHOTS=1 npm run test:e2e`.

## The 14-step end-to-end flow

The automated suites cover everything that can run headless. Steps **6**,
**10**, and **13** need physical phones (two+ devices on the same Wi-Fi/LAN;
the host on a laptop, guests on phones). Expected results are in bold.

1. **Open Create** (`/create`). Paste the contents of
   `examples/games/nova-quiz.html` into the editor.
2. **Run four simulated players.** Press _Test multiplayer_ → the arena
   loads with two players; add two more with _Add player_. **Every frame
   registers "Nova Quiz" (state mode), "Test passed" appears, and after a
   brief "Waiting for players" card, round 1 goes live in all four frames.**
3. _(covered by 2)_
4. **Save locally.** Back in the editor, save the game. **It appears in the
   library (`/library`) and reopens from there.**
5. **Create party.** Open the game → _Play with friends_ (or the party
   route). **The lobby shows a four-letter code and an invite link.**
6. **🔴 MANUAL — Join from at least two physical phones.** Open the invite
   link (or enter the code) on each phone; the creator approves each join
   request. **Both phones show the party lobby with the game title and
   their own names; transfer progress reaches 100% and both show ready.**
7. **Transfer game.** Automatic (P3). **Phones report "Game received" and
   their game frames boot.**
8. **Start.** Press Start once every member is ready. **All frames show the
   "Get ready" card, then round 1 question with "Player 1 is the
   quizmaster".**
9. **Perform actions.** Answer on each phone; the quizmaster reveals.
   **The correct answer is shown only after the reveal; scores update
   identically on every device; the next round's quizmaster rotates.**
10. **🔴 MANUAL — Background the authority phone.** With a round open (some
    answers in), background/lock the phone that holds the authority (the
    arena shows the Authority badge; in a real party it is the game's first
    player). **Within a few seconds the remaining devices keep playing:
    the round reveals, scores update, and the next round starts. No one
    sees an error.**
11. **Observe migration.** (In the arena, this is the "Authority loss" /
    _Suspend_ + _Resume_ pair of buttons; in a real party it is invisible
    by design.) **The game continues without interruption.**
12. **Continue.** **Two more full rounds play on the remaining phones.**
13. **🔴 MANUAL — Reconnect the suspended phone.** Unlock/foreground the
    phone (or reload it). **It rejoins automatically, shows the current
    round/question, and can answer the next round.**
14. **End game and return to lobby.** Press _End game for everyone_ in the
    play shell. **Every device returns to the party lobby with an
    "ended" notice; leaving the party cleans up.**

## Troubleshooting

- **A frame shows "Nova error (stale_revision)"** — that is normal racing
  (two devices acted on the same revision); the game retries and the next
  view settles it. Stable codes are logged, never generic failures.
- **The authority badge does not move in the arena** — it moves on the
  `authorityChanged` host event; if it seems stuck, check that the
  suspended player's card shows "Suspended" and give the election a moment
  (heartbeat grace 5 s by default).
- **Trystero e2e flakiness** — public relays rate-limit/restrict kinds
  22285/22871; re-run, or run when the network is stable
  (`e2e-trystero/README.md`).
