import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSE_CATEGORIES,
  CATALOG_CONNECT_ORIGINS,
  CATALOG_IMAGE_ORIGINS,
  EXTERNAL_FRAME_ORIGINS,
  EXTERNAL_GAMES,
  categoriesOf,
  displayUrlText,
  externalFrameUrl,
  findExternalGame,
  findCatalogGame,
  playerCountText,
} from ".";
import { randomRoomId, rocketcrabUrl, roomField } from "./join-url";

const MARY = { name: "Mary", isHost: false };

function game(id: string) {
  const found = findExternalGame(id);
  if (found === undefined) throw new Error(`no game ${id}`);
  return found;
}

describe("external games data", () => {
  it("lists every external game (18) with unique ids", () => {
    expect(EXTERNAL_GAMES.length).toBe(18);
    const ids = EXTERNAL_GAMES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["protobowl", "netgamesio-avalon", "ooc-story"]));
  });

  it("has complete metadata, valid URLs, and a difficulty for every game", () => {
    for (const entry of EXTERNAL_GAMES) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.author.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(["easy", "medium", "hard"]).toContain(entry.difficulty);
      expect(() => new URL(entry.displayUrlHref!)).not.toThrow();
      expect(entry.play.kind).toBe("external");
      expect(entry.play.frameOrigins.length).toBeGreaterThan(0);
      expect(categoriesOf(entry).length).toBeGreaterThan(0);
    }
  });

  it("derives link text from the website and the player count from limits", () => {
    expect(displayUrlText(game("qwiqwit"))).toBe("qwiqwit.com");
    expect(displayUrlText(findCatalogGame("drawphone")!)).toBe("drawphone.tannerkrewson.com");
    expect(playerCountText(game("werewolfnight"))).toBe("5-16");
    expect(playerCountText({ ...game("werewolfnight"), players: undefined })).toBe("5–16");
  });

  it("files games under difficulty and genre, with no provider category", () => {
    expect(BROWSE_CATEGORIES.map((category) => category.id)).not.toContain("netgamesio");
    expect(categoriesOf(findCatalogGame("drawphone")!).map((category) => category.id)).toEqual([
      "easy",
      "drawing",
    ]);
    expect(categoriesOf(game("netgamesio-avalon")).map((category) => category.id)).toEqual([
      "medium",
    ]);
  });

  it("collects unique frame, image, and connect origins for the CSP", () => {
    expect(new Set(EXTERNAL_FRAME_ORIGINS).size).toBe(EXTERNAL_FRAME_ORIGINS.length);
    expect(EXTERNAL_FRAME_ORIGINS).not.toContain("https://dpk.tannerkrewson.com");
    expect(CATALOG_CONNECT_ORIGINS).toContain("https://drawphone.tannerkrewson.com");
    expect(EXTERNAL_FRAME_ORIGINS).toContain("https://netgames.io");
    for (const entry of EXTERNAL_GAMES) {
      for (const url of entry.pictures ?? []) {
        expect(CATALOG_IMAGE_ORIGINS).toContain(new URL(url).origin);
      }
    }
    // Games that create rooms with a direct fetch need connect-src.
    expect(CATALOG_CONNECT_ORIGINS).toContain("https://fishbowl-graphql.onrender.com");
    expect(CATALOG_CONNECT_ORIGINS).toContain("https://www.googleapis.com");
  });
});

describe("external room creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function relayReturning(body: unknown) {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // The production CSP allows the edge relay plus CATALOG_CONNECT_ORIGINS, so a
  // game that fetches anything else would fail only in a deployed build.
  it("only fetches origins the CSP's connect-src allows", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        fetched.push(new URL(String(url), location.origin).origin);
        throw new Error("no network in tests");
      }),
    );
    for (const entry of EXTERNAL_GAMES) {
      await entry.play.createRoom().catch(() => undefined);
    }
    expect(fetched.length).toBeGreaterThan(0);
    for (const origin of new Set(fetched)) {
      expect([location.origin, ...CATALOG_CONNECT_ORIGINS]).toContain(origin);
    }
  });

  it("derives URL rooms from random ids without a fetch", async () => {
    expect((await game("protobowl").play.createRoom()).url).toMatch(
      /^https:\/\/protobowl\.com\/rocketcrab-[0-9a-f]{16}$/,
    );
    expect((await game("justone").play.createRoom()).url).toMatch(
      /^https:\/\/just1\.herokuapp\.com\/room\/rocketcrab-[0-9a-f]{16}$/,
    );
  });

  it("surfaces a readable error when the relay fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(game("werewolfnight").play.createRoom()).rejects.toThrow(
      /relay request failed \(HTTP 503\)/,
    );
  });

  it("lists Drawphone as a hosted Nova game", () => {
    expect(findExternalGame("drawphone")).toBeUndefined();
    expect(findCatalogGame("drawphone-kids")).toBeUndefined();
    expect(findCatalogGame("drawphone")?.play).toEqual({
      kind: "nova",
      url: "https://drawphone.tannerkrewson.com/drawphone.html",
    });
  });

  it("lists Traitors, formerly Snakeout, as two hosted Nova games", () => {
    expect(findExternalGame("snakeout")).toBeUndefined();
    expect(findCatalogGame("traitors")?.play).toEqual({
      kind: "nova",
      url: "https://www.tannerkrewson.com/traitors/game.html",
    });
    expect(findCatalogGame("traitors-banishment")?.play).toEqual({
      kind: "nova",
      url: "https://www.tannerkrewson.com/traitors/game-banishment.html",
    });
  });

  it("keeps the existing Spyfall transfer ID and uses hosted Nova play", () => {
    expect(findExternalGame("tk-spyfall")).toBeUndefined();
    expect(findCatalogGame("tk-spyfall")?.play).toEqual({
      kind: "nova",
      url: "https://www.tannerkrewson.com/spyfall/game.html",
    });
    expect(CATALOG_CONNECT_ORIGINS).toContain("https://www.tannerkrewson.com");
  });

  it("outofcontext.party and netgames.io return URL rooms from the relay", async () => {
    let fetchMock = relayReturning({ code: "RC42" });
    expect(await game("ooc-story").play.createRoom()).toEqual({
      url: "https://outofcontext.party/lobby/RC42",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      endpoint: "ooc-rocketcrab",
      body: { game: "story", version: 1 },
    });
    fetchMock = relayReturning({ url: "https://netgames.io/games/avalon/ROOM-1" });
    expect(await game("netgamesio-avalon").play.createRoom()).toEqual({
      url: "https://netgames.io/games/avalon/ROOM-1",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      endpoint: "netgamesio-new",
      urlId: "avalon",
    });
  });

  it("keeps each relay game's join URL shape", async () => {
    relayReturning({ gameCode: "XYZ9" });
    const join = async (id: string) =>
      game(id).play.joinUrl(await game(id).play.createRoom(), { name: "Al", isHost: true });
    expect(await join("werewolfnight")).toBe(
      "https://werewolf-night.com/game?rocketcrab=true&name=Al&ishost=true&roomId=XYZ9",
    );
    expect(await join("secrethitler-duc")).toBe(
      "https://secret-hitler.com/?rocketcrab=true&name=Al&ishost=true&roomId=XYZ9",
    );
  });

  it("fishbowl renames the rocketcrab parameter to hideshare", () => {
    expect(
      game("fishbowl").play.joinUrl({ url: "https://fishbowl-game.com/game/abc/lobby" }, MARY),
    ).toBe("https://fishbowl-game.com/game/abc/lobby?hideshare=true&name=Mary&ishost=false");
  });
});

describe("join URLs", () => {
  it("adds the automatic parameters; extras override them; a hash goes last", () => {
    expect(rocketcrabUrl("https://game.example/room", MARY)).toBe(
      "https://game.example/room?rocketcrab=true&name=Mary&ishost=false",
    );
    expect(
      rocketcrabUrl(
        "https://game.example/",
        { name: "Mary", isHost: true },
        { params: { name: "Bob", code: "X1" }, hash: "#go" },
      ),
    ).toBe("https://game.example/?rocketcrab=true&name=Bob&ishost=true&code=X1#go");
  });

  it("fails clearly when a room is missing a field", () => {
    expect(() => roomField({}, "code")).toThrow("The game room is missing its code.");
    expect(() => game("werewolfnight").play.joinUrl({}, MARY)).toThrow(/missing its code/);
  });

  it("refuses a room that points outside the game's site", () => {
    expect(() =>
      externalFrameUrl(game("protobowl"), { url: "https://evil.example/" }, MARY),
    ).toThrow("Protobowl's room points outside the game's site.");
    expect(
      externalFrameUrl(game("protobowl"), { url: "https://protobowl.com/rocketcrab-1" }, MARY),
    ).toContain("https://protobowl.com/rocketcrab-1?");
  });

  it("randomRoomId returns 16 hex characters", () => {
    expect(randomRoomId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
