# ADR-0002: Untrusted single-HTML game model

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0001 (runtime origins), ADR-0009 (network policy), F4, U4, P3

## Context

Nova does not generate games itself. A creator copies a master AI prompt into
their preferred chat service, is interviewed, and receives **one complete HTML
document in one code block**, which they paste into Nova. Creators must not
need to install tools, understand code, deploy a website, or create a
repository.

The game format therefore has to be trivial to produce for a chatbot and
trivial to move around, while remaining powerful enough for real games.

## Decision

**A game is one complete HTML document stored as a string.**

- No custom cartridge parser, no multipart syntax, no manifest format.
  "Cartridge" may be used as product terminology, but its concrete
  representation is ordinary HTML.
- A game may use:
  - inline HTML, CSS, and JavaScript;
  - inline or remote ESM modules;
  - public CDNs such as jsDelivr or esm.sh;
  - remote images, audio, fonts, video, models, and data;
  - `fetch`, WebSockets, Web Workers, canvas/WebGL, and browser media/device
    APIs when permitted by the browser and the runtime frame.
- Nova does **not** proxy or rewrite imports, assets, or requests (see
  ADR-0009). The master AI prompt recommends version-pinned dependency URLs
  (A4), but enforcement is by recommendation, not by rewrite.

The game HTML is untrusted (see `docs/architecture/threat-model.md`) and runs
only inside the isolated runtime origin (ADR-0001).

## Alternatives considered

1. **Custom cartridge language or binary format.** Rejected: requires a
   parser, a spec, a compiler story, and heavy chatbot prompting. Nothing in
   the product needs it.
2. **Multi-file game projects.** Rejected: pasting, storing, transferring, and
   validating multiple files is strictly harder for creators and for the
   peer-to-peer transfer path (P3).
3. **JS-only API surface (no HTML).** Rejected: games need layout, CSS, media,
   and canvas; wrapping HTML rendering behind a framework contradicts the
   "no wrapper around ordinary HTML rendering" design goal of S1.
4. **Nova-hosted bundle service.** Rejected: requires a backend and conflicts
   with ADR-0001.

## Tradeoffs

- **Capability vs. verifiability.** Arbitrary HTML cannot be statically proven
  safe or correct. Nova mitigates with isolation (F4), protocol validation
  (F6), and observable-failure diagnostics (U4, B4) — not with sanitization.
- **Remote dependencies.** Real games get rich libraries, but a CDN or API
  outage can break a game (Blocker Register B4). Nova does not proxy the web.
- **Single document size.** Games are bounded by a source-size limit (F6, P3)
  rather than by a module graph.

## Consequences

- The runtime must actually execute pasted HTML — F4 validates this on
  physical devices, including remote ESM, WebGL, audio, and isolation.
- U4 detects only _observable_ validation failures (empty source, missing
  structure, missing registration, oversized source, syntax errors, remote
  load failures). It does not attempt to prove correctness.
- P3 transfers the exact HTML string peer-to-peer, verified by SHA-256, so all
  players run byte-identical documents.
- The repository layout reserves `examples/games` for complete single-HTML
  sample games (S4, M4).
