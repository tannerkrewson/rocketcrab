import type { NovaCatalogGame } from "./types.ts";

const drawphoneBase: Omit<NovaCatalogGame, "id" | "name" | "play"> = {
  author: "Tanner Krewson",
  description: `In Drawphone, there are no winners... only losers! Players
        take turns drawing pictures and guessing what those pictures are. If
        you guess correctly, nothing happens! If you guess wrong or draw like a
        toddler and ruin the chain of drawings and guesses, rest assured that
        you will be mercilessly mocked for your honest mistake (which
        ultimately doesn't even matter in the grand scheme of the world).

        Drawphone was inspired by Evan Brumley's 2015 online Spyfall
        implementation, Jackbox Games's Drawful, and Telestrations.`,
  displayUrlHref: "https://drawphone.tannerkrewson.com/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://drawphone.tannerkrewson.com/how-to-play",
  pictures: [
    "https://i.imgur.com/tHPfWpp.png",
    "https://i.imgur.com/EFQiuyd.png",
    "https://i.imgur.com/14aDZKn.png",
    "https://i.imgur.com/CwsMi5k.png",
  ],
  difficulty: "easy",
  genres: ["drawing"],
  minPlayers: 1,
  maxPlayers: 64,
};

/**
 * Hosted Nova games: one self-contained HTML file each, fetched by the host
 * when picked and shared with the party like any saved game. To port and
 * list one, see hosted-nova-games.md.
 */
export const NOVA_GAMES: readonly NovaCatalogGame[] = [
  {
    ...drawphoneBase,
    id: "drawphone",
    name: "Drawphone",
    play: { kind: "nova", url: "https://drawphone.tannerkrewson.com/drawphone.html" },
  },
];
