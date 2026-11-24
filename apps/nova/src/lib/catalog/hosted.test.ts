import { describe, expect, it, vi } from "vitest";
import { htmlSourceBytes } from "@rocketcrab/protocol";
import { NOVA_GAMES } from "./nova-games";
import { fetchHostedNovaSource } from "./hosted";
import { selectCatalogGame } from "./select";
import { findCatalogGame } from ".";
import type { NovaCatalogGame } from "./types";

const GAME: NovaCatalogGame = {
  id: "hosted-quiz",
  name: "Hosted Quiz",
  author: "Someone",
  description: "A quiz on GitHub Pages.",
  difficulty: "easy",
  genres: ["trivia"],
  play: { kind: "nova", url: "https://someone.github.io/quiz/index.html" },
};

const HTML = "<!doctype html><html><body><script>nova.defineGame({})</script></body></html>";

function respond(body: string, status = 200) {
  return vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status }),
  );
}

describe("fetchHostedNovaSource", () => {
  it("downloads the game's HTML without credentials", async () => {
    const fetcher = respond(HTML);
    await expect(fetchHostedNovaSource(GAME, fetcher)).resolves.toBe(HTML);
    expect(fetcher).toHaveBeenCalledWith("https://someone.github.io/quiz/index.html", {
      credentials: "omit",
      cache: "no-cache",
    });
  });

  it("resolves a first-party path against Nova's own origin", async () => {
    const fetcher = respond(HTML);
    await fetchHostedNovaSource({ ...GAME, play: { kind: "nova", url: "/games/q.html" } }, fetcher);
    expect(fetcher.mock.calls[0]![0]).toBe(new URL("/games/q.html", location.href).href);
  });

  it("explains HTTP errors, network failures, empty files, and oversized games", async () => {
    await expect(fetchHostedNovaSource(GAME, respond("nope", 404))).rejects.toThrow(
      "someone.github.io couldn't send Hosted Quiz (HTTP 404).",
    );
    await expect(
      fetchHostedNovaSource(
        GAME,
        vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).rejects.toThrow("Couldn't reach someone.github.io to download Hosted Quiz.");
    await expect(fetchHostedNovaSource(GAME, respond("   "))).rejects.toThrow(/empty file/);
    await expect(
      fetchHostedNovaSource(GAME, respond("x".repeat(htmlSourceBytes + 1))),
    ).rejects.toThrow(/games can be at most 2 MB/);
  });
});

describe("selectCatalogGame", () => {
  it("creates a room for an external game", async () => {
    const engine = { selectGame: vi.fn(async () => {}) };
    await selectCatalogGame(engine, findCatalogGame("protobowl")!);
    expect(engine.selectGame).toHaveBeenCalledWith({ kind: "external", gameId: "protobowl" });
  });

  it("shares a hosted Nova game like a saved one", async () => {
    vi.stubGlobal("fetch", respond(HTML));
    try {
      const engine = { selectGame: vi.fn(async () => {}) };
      await selectCatalogGame(engine, GAME);
      expect(engine.selectGame).toHaveBeenCalledWith({
        gameId: "hosted-quiz",
        title: "Hosted Quiz",
        source: HTML,
        apiVersion: 1,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("NOVA_GAMES", () => {
  it("uses HTTPS or a path on Nova's own origin for every entry", () => {
    for (const game of NOVA_GAMES) {
      expect(game.play.url.startsWith("https://") || game.play.url.startsWith("/")).toBe(true);
    }
  });
});
