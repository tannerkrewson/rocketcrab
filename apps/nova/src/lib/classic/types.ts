/**
 * Classic Rocketcrab external iframe games (phase 7 classic port,
 * rocketcrab-9fv.7.7.1).
 *
 * These games are hosted by third parties and embedded via iframe, exactly
 * like classic rocketcrab (dev branch `config/games/*`). Nova is
 * backendless, so each game's room-creation flow (classic ran it once per
 * party on the server via `connectToGame`) runs in the player's browser
 * before the iframe opens. The resulting URL spec is shared with party peers
 * through the Nova party plane (browse/party UI is a sibling task).
 */

/** URL spec for one role in a classic game (classic `ConnectedGameURL`). */
export interface ClassicGameUrlSpec {
  /** Base URL of the game/room to embed in the iframe. */
  url: string;
  /**
   * Extra query params merged after the automatic
   * rocketcrab/name/ishost params (classic `customQueryParams`).
   */
  customQueryParams?: Record<string, string>;
  /** String appended after the query string, e.g. "#hash". */
  afterQueryParams?: string;
}

/** Result of a classic game's connect flow (classic `ConnectedGame`). */
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

/**
 * A classic Rocketcrab external iframe game (ported from the dev branch
 * `config/games/*`). The `kind: "classic"` literal distinguishes these from
 * Nova games (`SavedGame`) so the shared prebuilt-game browser
 * (rocketcrab-9fv.7.7.2) can badge and list them together.
 */
export interface ClassicGame {
  /** Unique id, e.g. "drawphone" or "netgamesio-avalon". */
  id: string;
  /** Always "classic" — distinguishes classic games from Nova games. */
  kind: "classic";
  name: string;
  author: string;
  basedOn?: ClassicGameBasedOn | null;
  description: string;
  /** Shown text for the game's website link ("drawphone.tannerkrewson.com"). */
  displayUrlText: string;
  /** The game's website. */
  displayUrlHref: string;
  donationUrlText?: string;
  donationUrlHref?: string;
  /** Link to the rule book / how-to-play guide (classic also rendered it). */
  guideUrl?: string;
  /** Screenshot URLs. */
  pictures?: string[];
  /** Classic categories: easy, medium, hard, drawing, writing, trivia, netgamesio. */
  category: string[];
  /** Recommended player count as free text ("5-10"). */
  players?: string;
  minPlayers?: number;
  maxPlayers?: number;
  /**
   * Creates a fresh room on the external service and returns the URL spec(s)
   * to embed. Runs client-side in Nova (classic ran it once per party on the
   * server). May throw; callers surface the error to the player so they can
   * take it back to the game's author.
   */
  connectToGame: () => Promise<ClassicGameConnectResult>;
  /**
   * Maps the automatic query params (rocketcrab/name/ishost) to the game's
   * own param names (classic `renameParams`).
   */
  renameParams?: Record<string, string>;
  /**
   * The origins the game's iframe is served from. Used as the CSP
   * `frame-src` allowlist on Nova's main origin (strict CSP, ADR-0001).
   */
  frameOrigins: string[];
}
