import type { NovaCatalogGame } from "./types";

/**
 * Hosted Nova games: one self-contained HTML file each, fetched by the host
 * when picked and shared with the party like any saved game. A URL's origin
 * must also be in the main origin's CSP `connect-src` (vite.config.ts reads
 * this list).
 */
export const NOVA_GAMES: readonly NovaCatalogGame[] = [];
