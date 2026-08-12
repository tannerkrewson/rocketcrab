import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom's window.scrollTo is a no-op that logs "Not implemented" (TanStack
// Router scrolls on route changes); override it to keep test output clean.
window.scrollTo = () => undefined;
