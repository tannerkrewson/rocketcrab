/**
 * Third-party games embedded via iframe. Room creation runs before the
 * frame opens, and the resulting URL is shared through the party plane.
 */

/** URL spec for one role in an external game. */
export interface ClassicGameUrlSpec {
  /** Base URL of the game/room to embed in the iframe. */
  url: string;
  /** Extra query params override the automatic rocketcrab/name/ishost params. */
  customQueryParams?: Record<string, string>;
  /** String appended after the query string, e.g. "#hash". */
  afterQueryParams?: string;
}

/** Room-creation result shared with party peers. */
export interface ClassicGameConnectResult {
  /** URL spec used by every player. */
  player: ClassicGameUrlSpec;
  /** Optional host-only overrides; merged over `player` for the host. */
  host?: Partial<ClassicGameUrlSpec>;
}

/** The board/party game a classic online game is based on. */
export interface ClassicGameBasedOn {
  game: string;
  author?: string;
  link?: string;
  bggId?: number;
}

/** External iframe game metadata and room-creation behavior. */
export interface ClassicGame {
  /** Unique id, e.g. "drawphone" or "netgamesio-avalon". */
  id: string;
  kind: "classic";
  name: string;
  author: string;
  basedOn?: ClassicGameBasedOn | null;
  description: string;
  /** Shown text for the game's website link ("drawphone.tannerkrewson.com"). */
  displayUrlText: string;
  displayUrlHref: string;
  donationUrlText?: string;
  donationUrlHref?: string;
  /** Rule book or how-to-play guide. */
  guideUrl?: string;
  pictures?: string[];
  /** Classic categories: easy, medium, hard, drawing, writing, trivia, netgamesio. */
  category: string[];
  /** Recommended player count as free text ("5-10"). */
  players?: string;
  minPlayers?: number;
  maxPlayers?: number;
  /** Create a fresh external room; callers surface failures to the player. */
  connectToGame: () => Promise<ClassicGameConnectResult>;
  /** Map automatic rocketcrab/name/ishost parameters to the game's own names. */
  renameParams?: Record<string, string>;
  /**
   * The origins the game's iframe is served from. Used as the CSP
   * `frame-src` allowlist on Nova's main origin (strict CSP, ADR-0001).
   */
  frameOrigins: string[];
}
