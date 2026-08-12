import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_FRAME_ORIGINS, CLASSIC_GAMES, findClassicGame } from "./games";
import type { ClassicGameConnectResult } from "./types";
import { buildClassicGameUrl, randomRoomId } from "./url";

/**
 * Classic game port tests (rocketcrab-9fv.7.7.1): the whole classic game
 * list is present with unique ids, every game is marked "classic", the
 * client-side room-creation flows produce the same URL shapes classic
 * produced on its server, and the URL builder matches classic's
 * `useConnectedGame` behavior.
 */

describe("CLASSIC_GAMES data", () => {
  it("ports the whole classic game list (22 games) with unique ids", () => {
    expect(CLASSIC_GAMES.length).toBe(22);
    const ids = CLASSIC_GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Spot-check a few known ids from the dev branch config/games/*.
    expect(ids).toEqual(
      expect.arrayContaining([
        "protobowl",
        "setwithfriends",
        "drawphone",
        "drawphone-kids",
        "fishbowl",
        "justone",
        "longwave",
        "netgamesio-avalon",
        "netgamesio-enigma",
        "ooc-story",
        "ooc-recipe",
        "qwiqwit",
        "secrethitler-duc",
        "snakeout",
        "tk-spyfall",
        "werewolfnight",
      ]),
    );
  });

  it("marks every game as classic so the browser can badge them", () => {
    for (const game of CLASSIC_GAMES) {
      expect(game.kind).toBe("classic");
    }
  });

  it("has complete metadata and valid URLs for every game", () => {
    for (const game of CLASSIC_GAMES) {
      expect(game.name.length).toBeGreaterThan(0);
      expect(game.author.length).toBeGreaterThan(0);
      expect(game.description.length).toBeGreaterThan(0);
      expect(game.category.length).toBeGreaterThan(0);
      expect(() => new URL(game.displayUrlHref)).not.toThrow();
      expect(game.frameOrigins.length).toBeGreaterThan(0);
      for (const origin of game.frameOrigins) {
        expect(() => new URL(origin)).not.toThrow();
      }
      expect(typeof game.connectToGame).toBe("function");
    }
  });

  it("findClassicGame resolves ids and returns undefined for unknown ids", () => {
    expect(findClassicGame("drawphone")?.name).toBe("Drawphone");
    expect(findClassicGame("netgamesio-avalon")?.name).toBe("Avalon");
    expect(findClassicGame("ooc-story")?.name).toBe("Raconteur");
    expect(findClassicGame("does-not-exist")).toBeUndefined();
  });

  it("CLASSIC_FRAME_ORIGINS is the unique origin set incl. both drawphone origins", () => {
    expect(new Set(CLASSIC_FRAME_ORIGINS).size).toBe(CLASSIC_FRAME_ORIGINS.length);
    expect(CLASSIC_FRAME_ORIGINS).toContain("https://drawphone.tannerkrewson.com");
    expect(CLASSIC_FRAME_ORIGINS).toContain("https://dpk.tannerkrewson.com");
    expect(CLASSIC_FRAME_ORIGINS).toContain("https://netgames.io");
    expect(CLASSIC_FRAME_ORIGINS).toContain("https://outofcontext.party");
    expect(CLASSIC_FRAME_ORIGINS).toContain("https://fishbowl-game.com");
  });
});

describe("classic room-creation flows (client-side connectToGame)", () => {
  const jsonResponse = (value: unknown) => ({
    ok: true,
    status: 200,
    json: async () => value,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drawphone POSTs /new and returns the room code as a query param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ gameCode: "ABC123" })),
    );
    const connected = await findClassicGame("drawphone")!.connectToGame();
    expect(connected.player).toEqual({
      url: "https://drawphone.tannerkrewson.com/",
      customQueryParams: { code: "ABC123" },
    });
  });

  it("drawphone-kids uses the dpk origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ gameCode: "K1D5" })),
    );
    const connected = await findClassicGame("drawphone-kids")!.connectToGame();
    expect(connected.player.url).toBe("https://dpk.tannerkrewson.com/");
    expect(connected.player.customQueryParams).toEqual({ code: "K1D5" });
  });

  it("outofcontext.party games POST the game id and join the lobby URL", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ code: "RC42" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const connected = await findClassicGame("ooc-story")!.connectToGame();
    expect(connected.player).toEqual({ url: "https://outofcontext.party/lobby/RC42" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://outofcontext.party/api/v1/rocketcrab");
    expect(JSON.parse(String(init?.body))).toEqual({ game: "story", version: 1 });
  });

  it("netgames.io games use the redirected room URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://netgames.io/games/avalon/ROOM-1",
      })),
    );
    const connected = await findClassicGame("netgamesio-avalon")!.connectToGame();
    expect(connected.player).toEqual({ url: "https://netgames.io/games/avalon/ROOM-1" });
  });

  it("tk-spyfall joins the created room by path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ gameCode: "XYZ9" })),
    );
    const connected = await findClassicGame("tk-spyfall")!.connectToGame();
    expect(connected.player).toEqual({ url: "https://spyfall.tannerkrewson.com/XYZ9" });
  });

  it("snakeout returns the room code as a query param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ gameCode: "SNAKE" })),
    );
    const connected = await findClassicGame("snakeout")!.connectToGame();
    expect(connected.player).toEqual({
      url: "https://snakeout.tannerkrewson.com/",
      customQueryParams: { code: "SNAKE" },
    });
  });

  it("protobowl and justone derive room URLs from random ids without a fetch", async () => {
    const connected = await findClassicGame("protobowl")!.connectToGame();
    expect(connected.player.url).toMatch(/^https:\/\/protobowl\.com\/rocketcrab-[0-9a-f]{16}$/);
    const justone = await findClassicGame("justone")!.connectToGame();
    expect(justone.player.url).toMatch(
      /^https:\/\/just1\.herokuapp\.com\/room\/rocketcrab-[0-9a-f]{16}$/,
    );
  });

  it("surfaces a readable error when the room-creation endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(findClassicGame("drawphone")!.connectToGame()).rejects.toThrow(
      /Couldn't reach drawphone\.tannerkrewson\.com to create a room \(HTTP 503\)/,
    );
  });
});

describe("buildClassicGameUrl", () => {
  it("adds the automatic rocketcrab/name/ishost params", () => {
    const url = buildClassicGameUrl(
      { player: { url: "https://game.example/room" } },
      {},
      { name: "Mary", isHost: false },
    );
    expect(url).toBe("https://game.example/room?rocketcrab=true&name=Mary&ishost=false");
  });

  it("merges host spec over player spec for the host", () => {
    const connected: ClassicGameConnectResult = {
      player: { url: "https://game.example/room", customQueryParams: { role: "player" } },
      host: { customQueryParams: { role: "host", admin: "1" } },
    };
    const url = buildClassicGameUrl(connected, {}, { name: "Mary", isHost: true });
    expect(url).toBe(
      "https://game.example/room?rocketcrab=true&name=Mary&ishost=true&role=host&admin=1",
    );
  });

  it("applies renameParams (fishbowl maps rocketcrab to hideshare)", () => {
    const url = buildClassicGameUrl(
      { player: { url: "https://fishbowl-game.com/game/abc/lobby" } },
      { renameParams: { rocketcrab: "hideshare" } },
      { name: "Mary", isHost: false },
    );
    expect(url).toBe(
      "https://fishbowl-game.com/game/abc/lobby?hideshare=true&name=Mary&ishost=false",
    );
  });

  it("customQueryParams override automatic params and afterQueryParams is appended", () => {
    const url = buildClassicGameUrl(
      {
        player: {
          url: "https://game.example/",
          customQueryParams: { name: "Bob", code: "X1" },
          afterQueryParams: "#go",
        },
      },
      {},
      { name: "Mary", isHost: true },
    );
    expect(url).toBe("https://game.example/?rocketcrab=true&name=Bob&ishost=true&code=X1#go");
  });

  it("returns an empty string when there is no player spec", () => {
    expect(
      buildClassicGameUrl(
        { player: undefined as unknown as ClassicGameConnectResult["player"] },
        {},
        { name: "x", isHost: false },
      ),
    ).toBe("");
  });

  it("randomRoomId returns a 16-char hex suffix", () => {
    expect(randomRoomId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
