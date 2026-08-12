import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom's window.scrollTo is a no-op that logs "Not implemented" (TanStack
// Router scrolls on route changes); override it to keep test output clean.
window.scrollTo = () => undefined;

// ---------------------------------------------------------------------------
// Realm-safe TextEncoder (P3/P4 binary chunk path).
//
// jsdom wraps node's native TextEncoder, whose `encode()` returns typed
// arrays from node's realm — while the environment's global `Uint8Array`
// belongs to jsdom's realm. `instanceof Uint8Array` therefore fails for
// every encoded payload, which breaks the transport's binary-payload
// detection and the party coordinator's chunk decoding in tests (the same
// code passes in real browsers and in the package-level test suites).
// Wrap the encoder so encoded bytes come from the environment's global
// realm, keeping `instanceof` checks correct everywhere.
// ---------------------------------------------------------------------------
const NATIVE_TEXT_ENCODER = globalThis.TextEncoder;
if (NATIVE_TEXT_ENCODER !== undefined) {
  class RealmSafeTextEncoder {
    readonly encoding = "utf-8";

    encode(input: string = ""): Uint8Array {
      const source = new NATIVE_TEXT_ENCODER().encode(input);
      const copy = new Uint8Array(source.byteLength);
      copy.set(source);
      return copy;
    }

    encodeInto(input: string, dest: Uint8Array): { read: number; written: number } {
      return new NATIVE_TEXT_ENCODER().encodeInto(input, dest);
    }
  }
  globalThis.TextEncoder = RealmSafeTextEncoder as typeof TextEncoder;
}
