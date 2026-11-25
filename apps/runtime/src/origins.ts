/** Runtime bootstrap accepts the pinned main origin, or localhost in development. */
export const MAIN_ORIGIN_PORT = 2722;
export const RUNTIME_ORIGIN_PORT = 2723;

export function mainOriginForRuntimeOrigin(runtimeOrigin: string): string {
  const raw = import.meta.env.VITE_MAIN_ORIGIN;
  const override = typeof raw === "string" ? raw.trim() : "";
  if (override !== "") return new URL(override).origin;
  const url = new URL(runtimeOrigin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = String(MAIN_ORIGIN_PORT);
    return url.origin;
  }
  throw new Error("VITE_MAIN_ORIGIN must be set outside localhost development");
}
