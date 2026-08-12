/**
 * @rocketcrab/party
 *
 * The four-letter rendezvous and secure admission layer (P2; ADR-0004).
 *
 * Preserves the simple Rocketcrab room-code experience without a central
 * room-code server: a four-letter code names a PUBLIC rendezvous namespace,
 * a greeter advertises a minimal party summary there and explicitly admits
 * joiners, and the real party room is derived from a CSPRNG session secret
 * (Web Crypto, ADR-0011) — so guessing a code never admits a peer, colliding
 * parties stay distinguishable, and invite links bypass four-letter
 * discovery entirely.
 *
 * - `code.ts` — four-letter code generation/normalization (no I/O/L).
 * - `secrets.ts` — CSPRNG session secret and private room derivation.
 * - `invite.ts` — invite links (secret in the URL fragment only).
 * - `messages.ts` — party control message builders (validated with the
 *   protocol's Zod schemas; threat model T10).
 * - `rendezvous.ts` — creation, joining, admission, collision handling,
 *   greeter migration, and full listener cleanup (engineering rule 22).
 * - `game-source.ts` — peer-to-peer game source distribution over the
 *   established private-party transport (P3: metadata, request, binary
 *   chunk transfer with progress, hash verification, retry, cancellation,
 *   reconnect re-transfer, and the in-memory session cache).
 *
 * The layer is transport-neutral: it drives the {@link NovaTransport}
 * interface through a {@link PartyTransportFactory}, so the same flows run
 * over InMemoryTransport in deterministic tests and TrysteroTransport for
 * real parties. Party secrets never enter game runtime messages (the game
 * plane rides the `nova.protocol` channel; party control uses a separate
 * channel), and the private room password is enforced by the transport
 * (Trystero room password, F8).
 */
export * from "./code";
export * from "./secrets";
export * from "./invite";
export * from "./messages";
export * from "./rendezvous";
export * from "./game-source";
