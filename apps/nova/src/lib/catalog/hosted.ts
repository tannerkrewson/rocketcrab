import { htmlSourceBytes } from "@rocketcrab/protocol";
import type { NovaCatalogGame } from "./types";

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Fetch a hosted Nova game's HTML. Only the host calls this: everyone else
 * receives the host's verified copy, so a deploy mid-party can't split
 * versions. A relative URL is a first-party game on Nova's own origin.
 */
export async function fetchHostedNovaSource(
  game: NovaCatalogGame,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(game.play.url, globalThis.location?.href ?? "https://localhost/");
  let res: Response;
  try {
    res = await fetcher(url.href, { credentials: "omit", cache: "no-cache" });
  } catch {
    throw new Error(`Couldn't reach ${url.host} to download ${game.name}.`);
  }
  if (!res.ok) {
    throw new Error(`${url.host} couldn't send ${game.name} (HTTP ${res.status}).`);
  }
  const source = await res.text();
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > htmlSourceBytes) {
    throw new Error(
      `${game.name} is ${megabytes(bytes)}; games can be at most ${megabytes(htmlSourceBytes)}.`,
    );
  }
  if (source.trim().length === 0) {
    throw new Error(`${url.host} sent an empty file for ${game.name}.`);
  }
  return source;
}
