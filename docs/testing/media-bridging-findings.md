# A3 media bridging — spike findings and verdict

- **Status:** committed 2026-08-01; cross-frame device verification
  **PENDING** (no physical-device pass for track transfer yet; in-frame
  capture was verified on device by F4)
- **Owner:** Rocketcrab Nova planning (Phase 1), Blocker Register **B7**
- **Related:** ADR-0008 (shared runtime origin), ADR-0006 (modes),
  `docs/testing/runtime-sandbox-findings.md` (F4), threat model T9,
  issue rocketcrab-9fv.5.3 (A3)

## Goal

Determine how a game iframe that obtains camera or microphone access can
publish media through Nova's Trystero-managed party connection, especially
on Mobile Safari, and implement what the evidence supports. The spike was
asked to evaluate five options honestly and to **not assume** a cross-frame
media bridge works consistently merely because `MediaStreamTrack` is listed
as a structured-clone/transferable candidate in platform documentation.

## The frame chain (what F4 established)

```
main origin (host shell) ── postMessage bootstrap + MessageChannel ──▶ runtime origin
                                                                          │
                                                   same-origin game iframe │
                                                         (sandbox="allow-scripts
                                                          allow-same-origin",
                                                          allow="camera; microphone; …")
```

- The **game iframe is same-origin with the runtime page** (ADR-0008/B5).
  The injected bridge reports through a direct same-origin hook
  (`parent.__novaRuntime.report`), **not** postMessage — live objects can
  already reach the runtime page by reference.
- The **host ↔ runtime hop is a cross-origin MessageChannel postMessage**
  — a structured-clone boundary. Everything the runtime forwards today is
  Zod-validated plain data (threat model T10: "the only thing crossing the
  boundary is validated, versioned protocol messages").
- F4 (physical iPhone pass) verified: camera and microphone **capture works
  inside the game frame** with real devices and ordinary permission prompts
  (requires `allow="camera; microphone"` on **both** iframe hops; the
  runtime already carries this — `apps/runtime/src/main.ts`). F4 did **not**
  test moving a track across any frame boundary.
- F4 device findings that constrain media: device orientation/motion is
  denied without a prompt from a sandboxed cross-origin iframe; fullscreen
  and pointer lock are unsupported on iPhone Safari; CPU-exhaustion wedges
  the whole tab (isolation is per-site, not per-origin).

## What Trystero provides (verified in the pinned dependency)

Trystero 0.25.3 (via `@trystero-p2p/core`, which the pinned `trystero`
package re-exports) ships a **fully implemented media layer on the Room**
object, not just typings:

- `room.addStream(stream, { target, metadata })` and
  `room.addTrack(track, stream, { target, metadata })` attach local media
  to the **existing** peer connections (no new signaling needed — Trystero
  already negotiated the RTCPeerConnections for its data channels);
- `removeStream` / `removeTrack` / `replaceTrack`;
- `room.onPeerStream` / `room.onPeerTrack` deliver remote media;
- stream/track identity metadata travels over Trystero's data channel
  (verified in `node_modules/@trystero-p2p/core/dist/room.mjs` +
  `media.mjs`).

The transport adapter (`packages/trystero-transport`) does **not** expose
this surface today — `NovaTransport` is data-only by design (ADR-0003). So
the transport is _capable_ of carrying media; the open question is how the
game frame's media objects reach the peer connections, and whether that
path works on the supported Mobile Safari versions.

## Option-by-option evaluation

### 1. Passing `MediaStreamTrack` / `MediaStream` across the runtime MessageChannel

- **What the standards say.** The WHATWG structured-clone table lists
  `MediaStream` as structured-cloneable and `MediaStreamTrack` as
  cloneable **and transferable**; modern WebRTC ecosystems rely on this for
  main-thread ↔ worker / iframe track hand-off. Desktop Chromium implements
  it; Firefox support is version-dependent.
- **What this codebase would need.** The game → runtime hop is same-origin
  and already works by reference. The runtime → host hop would need the
  track to survive the MessageChannel postMessage, then the host would
  `room.addTrack()` it onto the Trystero peer connections, and the remote
  side would push the received track back down host → runtime → game frame
  (same-origin reference on the last hop).
- **Honest assessment.** The chain has **five unverified hops** on the
  supported platform. WebKit's implementation of media-object
  structured-clone/transfer is **not established** — I found no credible
  evidence that iOS Safari can transfer a `MediaStreamTrack` across a
  cross-origin postMessage boundary, and this spike cannot run an iPhone.
  Additionally, media objects cannot be Zod-validated (they are live,
  capability-carrying objects, not plain data), which conflicts with the
  runtime's T10 "validated plain data only" boundary unless a special-case
  path is built and defended. Transferring a track also detaches the
  sender's copy, which games using local preview would have to work around.
- **Verdict: not v1.** Unverified on the target platform; needs a
  device-verification pass before any code depends on it.

### 2. A game-facing `nova.media.publish(trackOrStream)` bridge

- **What it would look like.** The bridge shim forwards the track to the
  runtime through the same-origin hook, the runtime forwards it over the
  MessageChannel, the host attaches it to the Trystero room
  (`addTrack`/`addStream`), and remote peers receive it. Acquisition stays
  in the game frame (A3 acceptance: ordinary prompts).
- **Honest assessment.** Viability is gated **entirely** on option 1's
  cross-origin transfer question — the bridge is the API face of the same
  chain. There is also no inbound API for remote media yet (games would
  need `onRemoteTrack`/`onRemoteStream`), which this spike deliberately
  does not fabricate. On the data-only MVP this is pure new surface with no
  verified transport behind it.
- **Verdict: not v1.** Same blocker as option 1; the _surface_ is worth
  shipping in experimental form so games fail clearly (implemented here as
  `nova.media` — see below), but no media may cross the boundary yet.

### 3. Runtime-local Trystero media subchannels coordinated by Nova

- **What it would look like.** The runtime page hosts its own Trystero room
  for media, separate from the host's data room; the game frame hands media
  to the runtime (same-origin), which attaches it directly.
- **Honest assessment.** Architecturally attractive (the game → runtime hop
  is reference-based, no cross-origin transfer needed) but it violates two
  standing constraints: the runtime origin is **secret-free by construction**
  (ADR-0008, ADR-0011 — it may not hold party secrets like the room password),
  and the runtime is **Trystero-free** (the bridge and runtime bundle never
  touch Trystero; engineering rule 1 keeps transport code in
  `@rocketcrab/trystero-transport` on the host). A password-less media room
  would be a separate, unauthenticated rendezvous — not "the party
  connection" the issue requires.
- **Verdict: rejected** for v1 on architecture grounds (secret-free/Trystero-
  free runtime), independent of the browser-support question.

### 4. A separate WebRTC media path while retaining Trystero for discovery

- **What it would look like.** Peers signal a second `RTCPeerConnection`
  through the existing Trystero data channel, or — far simpler — attach
  media to the **existing** Trystero peer connections via `room.addTrack`
  (Trystero already provides the signaling and peer identity).
- **Honest assessment.** The "attach to the existing room connections"
  variant is the most promising _eventual_ architecture: it reuses the
  negotiated data-channel peers, so no new signaling surface is needed, and
  the host already owns the transport. It still requires the game frame's
  track to reach the host (option 1's question) and requires `onPeerTrack`
  delivery down to the remote game frame. As a v1 _host-only_ feature it
  cannot work at all, because the media originates inside the game frame.
- **Verdict: the recommended future architecture** (host-side
  `room.addTrack` on the existing connections), but not shippable until the
  cross-frame hop is device-verified. Do **not** build a second
  RTCPeerConnection mesh — it adds signaling complexity with no benefit over
  Trystero's existing peer connections.

### 5. Declaring media transport experimental if cross-frame compatibility is insufficient

- **What it would look like.** `nova.media` exists on the game-facing API
  so games can probe the platform and fail clearly; every attempt to
  publish fails with a stable `media_unsupported` error; the data-only
  protocol is untouched; the AI prompt describes media as experimental.
- **Honest assessment.** Matches the evidence: the data-only state-mode MVP
  is untouched (explicit blocking scope), no unverified cross-frame path is
  depended on, and unsupported combinations fail clearly (A3 acceptance).
  The `isSupported()` probe (can this realm structured-clone a `MediaStream`?)
  is a genuine, prompt-free capability signal that games, the host, and the
  device checklist can use — and a `false` result definitively rules out
  the whole bridge on that platform.
- **Verdict: implemented for v1** (see next section).

## Recommendation

**Ship option 5 — media transport is experimental — for v1.**

- `nova.media` is available on the game-facing API (parity between
  `createNovaClient` and the injected frame bridge):
  - `nova.media.isSupported()` — platform probe: can this realm
    structured-clone a `MediaStream`? Conservative and prompt-free; `true`
    is _necessary but not sufficient_ for the bridge, `false` rules it out.
  - `nova.media.publish(trackOrStream)` — after lifecycle (`not_started` /
    `ended`) and input (`invalid_options` for non-`MediaStreamTrack`/
    `MediaStream`) validation, **always throws** `NovaError` with the stable
    code `media_unsupported` in this build. The bridge never reports media
    to the runtime: there is no media transport path, and the protocol is
    unchanged (the data-only MVP is untouched).
- Camera/mic **acquisition stays inside the game iframe** with ordinary
  browser permission prompts (already delegated via the runtime iframe
  `allow` attribute; F4 verified on device). Nova handles only the party
  transport bridge where required — and today that bridge is declared
  unsupported rather than half-working.
- **Future work (not v1):** when the device checklist below passes, implement
  the option-4 architecture: game → runtime (same-origin reference) →
  host (MessageChannel transfer) → `room.addTrack` on the existing Trystero
  peer connections → `onPeerTrack` → host → runtime → game frame. This is
  Blocker Register B7's definition of done, and it remains blocked on
  physical-device evidence.

## Blocked platform behaviors (as of this spike)

| Behavior                                                                                             | Status                                                                         | Source                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Camera/mic capture inside the sandboxed game frame                                                   | **Works** (real devices, ordinary prompts)                                     | F4 physical pass                         |
| `allow="camera; microphone"` delegation at every iframe hop                                          | **In place**                                                                   | F4 finding; `apps/runtime/src/main.ts`   |
| Structured-cloning/transferring `MediaStream`/`MediaStreamTrack` across postMessage (host ↔ runtime) | **Unverified on Mobile Safari**; spec-listed, Chromium-implemented             | platform docs vs. this spike (no device) |
| Media objects as protocol payloads (Zod validation)                                                  | **Rejected by design** — live objects cannot be schema-validated; T10 boundary | this spike                               |
| Device orientation/motion permission from the sandboxed frame                                        | **Denied** on iPhone Safari (no prompt)                                        | F4 physical pass                         |
| Fullscreen / pointer lock                                                                            | **Unsupported** on iPhone Safari                                               | F4 physical pass                         |
| Runtime origin hosting Trystero media rooms                                                          | **Rejected** (secret-free / Trystero-free runtime; ADR-0008, ADR-0011)         | this spike                               |

## Device-verification checklist (executes when a physical iPhone is available)

Run on a real iPhone + Mobile Safari (and one desktop Chromium + one
Firefox for contrast), against the HTTPS spike shape F4 used:

1. `nova.media.isSupported()` in the game frame reports the platform truth
   (Safari expected `false` until WebKit implements media-object cloning;
   record the exact iOS/Safari version).
2. `getUserMedia({ video: true })` in the game frame shows exactly **one**
   ordinary browser prompt (never a Nova UI prompt) and capture renders in
   the frame.
3. Same-origin hand-off: the game hands its live track to the runtime page
   by reference; the runtime `addTrack`s it to an in-page
   `RTCPeerConnection` and confirms the remote side receives it. This
   isolates the reference hop from the transfer hop.
4. Cross-origin transfer: the runtime forwards the track to the host over
   the MessageChannel (`postMessage` with the track in the transfer list);
   the host `addTrack`s it onto a Trystero room connection; a second device
   receives it via `onPeerTrack`. **This is the make-or-break B7 check.**
5. Return path: the receiving host pushes the remote track down to its
   game frame (host → runtime → frame) and a `<video>`/`<audio>` element
   renders it.
6. Local preview: confirm the game can keep a local copy (clone-then-send)
   when transferring detaches the original.
7. Backgrounding: Safari suspends the page; confirm tracks end and
   re-acquisition after resume behaves (or fails clearly) — B6/M1 interplay.
8. Two-party vs. N-party: confirm `addTrack` fan-out to every connected
   peer and `removeTrack`/`replaceTrack` behavior on device.

Record results in this file (or a follow-up `media-bridging-findings.md`
revision) with iOS/Safari versions; **do not** flip B7 to "supported" from
desktop evidence alone.

## Threat and trust notes

- Media obtained by a game frame is **untrusted** (T9 / this task's scope):
  the runtime must never treat a game-supplied track/stream as validated
  data, and the host must attach it only to the party connection for the
  session that owns the frame — never to a different session, never with
  main-origin credentials, and never in a way that lets one game observe
  another's media (shared runtime origin, ADR-0008/B5).
- Permission scope is origin-wide: a camera/mic grant on the runtime origin
  extends to other games on that origin (ADR-0008). Mitigated by in-frame
  acquisition with ordinary prompts and by documentation.
- The experimental `nova.media` surface adds **no** new attack surface
  beyond the clear-failure contract: `publish` never forwards anything, and
  the runtime ignores unknown report kinds (a malicious game calling
  `parent.__novaRuntime.report("media.publish", …)` directly gets dropped at
  the boundary).

## What changed (file map)

- `packages/nova-api/src/media.ts` — probe + input validation + stable
  error contract (new).
- `packages/nova-api/src/types.ts` — `NovaMediaHandle` + `NovaApi.media`.
- `packages/nova-api/src/errors.ts` — stable code `media_unsupported`.
- `packages/nova-api/src/constants.ts` — `media` added to
  `NOVA_API_SURFACE`.
- `packages/nova-api/src/client.ts` — `nova.media` handle on
  `createNovaClient`.
- `apps/runtime/src/nova-bridge.ts` — in-frame `nova.media` (parity; never
  reports to the runtime).
- Tests: `packages/nova-api/src/media.test.ts` (new),
  `apps/runtime/src/nova-bridge.test.ts` (parity + experimental surface),
  `packages/nova-api/src/index.test.ts` (surface manifest, unchanged).

## Downstream impact

- **A4 (master AI prompt)** must describe media accurately: "camera and
  microphone capture works in your frame with ordinary permission prompts;
  publishing media to the party is **experimental and unsupported** — do
  not build voice/video multiplayer on `nova.media`." The AI reference
  (`docs/api/nova-api-ai-reference.md`) carries this wording.
- **M1 (harden Mobile Safari)** re-checks the permission delegation and
  records the track-transfer probe results from the checklist above.
- **M2** keeps the Permissions-Policy on the runtime origin in sync with
  the `allow` delegation.
- The data-only state-mode MVP is untouched: no protocol schema, no runtime
  message, and no transport change ships with this verdict.
