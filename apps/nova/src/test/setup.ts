import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom's window.scrollTo is a no-op that logs "Not implemented" (TanStack
// Router scrolls on route changes); override it to keep test output clean.
window.scrollTo = () => undefined;

// Node 26 exposes an experimental `localStorage` global that is undefined
// unless --localstorage-file is passed, and Vitest then leaves jsdom's storage
// unreachable from tests. Install a small in-memory Storage implementation when
// the environment provides none, so bare `localStorage`/`window.localStorage`
// behave identically on every supported Node version (CI pins 24).
function installMemoryStorage(key: "localStorage" | "sessionStorage"): void {
  if (typeof globalThis[key]?.getItem === "function") return;
  const area = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return area.size;
    },
    clear: () => area.clear(),
    getItem: (name) => area.get(String(name)) ?? null,
    key: (index) => [...area.keys()][index] ?? null,
    removeItem: (name) => void area.delete(String(name)),
    setItem: (name, value) => void area.set(String(name), String(value)),
  };
  Object.defineProperty(globalThis, key, { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, key, { value: storage, configurable: true, writable: true });
}
installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

// Native TextEncoder returns arrays from Node's realm, but transport binary
// detection uses jsdom's Uint8Array. Wrap it so instanceof checks succeed.
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
