/** Runtime origin is pinned in production; localhost development swaps ports. */
export const RUNTIME_ORIGIN_PORT = 2723;

export function runtimeOriginForMainOrigin(mainOrigin: string): string {
  const raw = import.meta.env.VITE_RUNTIME_ORIGIN;
  const override = typeof raw === "string" ? raw.trim() : "";
  if (override !== "") return new URL(override).origin;
  const url = new URL(mainOrigin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = String(RUNTIME_ORIGIN_PORT);
    return url.origin;
  }
  throw new Error("VITE_RUNTIME_ORIGIN must be set outside localhost development");
}
