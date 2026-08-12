// Vite raw-text imports (?raw) used by tests that load file fixtures.
declare module "*?raw" {
  const source: string;
  export default source;
}
