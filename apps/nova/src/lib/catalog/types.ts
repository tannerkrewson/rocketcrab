/**
 * The built-in game list. Every entry shares the same listing metadata;
 * `play` says how it runs. External games bring their own server: the
 * host creates one room and every player loads the game's site in an
 * iframe. Nova games run in Nova's isolated runtime from HTML the host
 * fetches from `url`.
 */
import type { ExternalRoom } from "@rocketcrab/protocol";

export type { ExternalRoom };

/** How much explaining a game needs before people can play. */
export type GameDifficulty = "easy" | "medium" | "hard";

/** What kind of game it is; a game can have several. */
export type GameGenre = "drawing" | "writing" | "trivia";

/** The board or party game an online game is based on. */
export interface GameBasedOn {
  readonly game: string;
  readonly author?: string;
  readonly link?: string;
  readonly bggId?: number;
}

/** Listing metadata shared by every entry, whatever runs it. */
export interface GameListing {
  /** Unique id, e.g. "drawphone" or "netgamesio-avalon". */
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly basedOn?: GameBasedOn | null;
  readonly description: string;
  /** The game's own website, shown by its host name. */
  readonly displayUrlHref?: string;
  readonly donationUrlText?: string;
  readonly donationUrlHref?: string;
  /** Rule book or how-to-play guide. */
  readonly guideUrl?: string;
  readonly pictures?: readonly string[];
  readonly difficulty: GameDifficulty;
  readonly genres: readonly GameGenre[];
  /** Recommended player count as free text ("5-10"); defaults to the limits. */
  readonly players?: string;
  /** Fewest players the game supports; the lobby says when the party has fewer. */
  readonly minPlayers?: number;
  /** Most players the game supports; the lobby says when the party has more. */
  readonly maxPlayers?: number;
}

/** The player an external game's frame URL is built for. */
export interface ExternalPlayer {
  readonly name: string;
  /** True for the member who created the room. */
  readonly isHost: boolean;
}

/** A game on its own server, embedded in an iframe. */
export interface ExternalPlay {
  readonly kind: "external";
  /** Origins the game's frames load from: the main origin's CSP `frame-src`. */
  readonly frameOrigins: readonly string[];
  /** Origins `createRoom` fetches directly (not via the relay): CSP `connect-src`. */
  readonly connectOrigins?: readonly string[];
  /** Create a fresh room; failures are shown to the host. */
  createRoom(): Promise<ExternalRoom>;
  /** The frame URL for one player in `room`. */
  joinUrl(room: ExternalRoom, player: ExternalPlayer): string;
}

/** A Nova game whose single HTML file is hosted elsewhere (e.g. GitHub Pages). */
export interface NovaPlay {
  readonly kind: "nova";
  /** Absolute HTTPS URL, or a path on Nova's own origin for first-party games. */
  readonly url: string;
}

export interface CatalogGame extends GameListing {
  readonly play: ExternalPlay | NovaPlay;
}

export type ExternalCatalogGame = CatalogGame & { readonly play: ExternalPlay };
export type NovaCatalogGame = CatalogGame & { readonly play: NovaPlay };
