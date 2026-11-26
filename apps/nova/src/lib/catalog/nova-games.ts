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

const tkSpyfall: NovaCatalogGame = {
  id: "tk-spyfall",
  name: "Spyfall",
  author: "Tanner Krewson",
  basedOn: {
    game: "Spyfall",
    author: "Alexandr Ushan",
    link: "https://www.cryptozoic.com/spyfall",
    bggId: 166384,
  },
  description: `In Spyfall, one random player will become the spy, and all
        others will be given a location and a role within the location. For
        example, if the location of a round was "restaurant," one player might
        be the chef, another the waiter, another the customer, etc. The players
        will not know who the spy is, and the spy will not know the location.

        Players take turns asking questions to each other, doing their best not
        to outright reveal the location in their questions and answers, but not
        being too vague as to raise suspicion. The non-spy group of players
        wins if they unanimously agree on the identity of the spy player. The
        spy wins if they figure out the location, which they have one chance to
        yell out at any time during the round, but loses if they guess wrong.
        The spy also wins if the other players unanimously accuse someone else,
        or cannot unanimously decide on someone to accuse.`,
  displayUrlHref: "https://www.tannerkrewson.com/spyfall/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://www.tannerkrewson.com/spyfall/how-to-play.html",
  difficulty: "medium",
  genres: [],
  players: "4+",
  minPlayers: 3,
  pictures: ["https://i.imgur.com/gAYGUUC.jpg", "https://i.imgur.com/8VMpYns.jpg"],
  play: { kind: "nova", url: "https://www.tannerkrewson.com/spyfall/game.html" },
};

const traitors: NovaCatalogGame = {
  id: "traitors",
  name: "Traitors: Sabotage",
  author: "Tanner Krewson",
  basedOn: {
    game: "The Resistance",
    author: "Don Eskridge",
    link: "https://indieboardsandcards.com/index.php/our-games/the-resistance/",
    bggId: 41114,
  },
  description: `Some of you are traitors. Nobody knows who.

        Traitors: Sabotage (formerly Snakeout) is a game in which a team of faithful
        players is infiltrated by a group of traitors. The faithful must try
        to figure out who the traitors are, and the traitors must try to keep
        the faithful from figuring out their identity. Each mission's team is
        voted on in the open, but missions are passed or sabotaged in secret.
        The first team to win three of the five missions wins the game.`,
  displayUrlHref: "https://www.tannerkrewson.com/traitors/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://www.tannerkrewson.com/traitors/how-to-play",
  pictures: [
    "https://www.tannerkrewson.com/traitors/screenshots/role.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/captain.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/vote.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/results.jpg",
  ],
  difficulty: "medium",
  genres: [],
  players: "5-10",
  minPlayers: 5,
  maxPlayers: 10,
  play: { kind: "nova", url: "https://www.tannerkrewson.com/traitors/game.html" },
};

const traitorsBanishment: NovaCatalogGame = {
  id: "traitors-banishment",
  name: "Traitors: Banishment",
  author: "Tanner Krewson",
  basedOn: {
    game: "Mafia",
    author: "Dimitry Davidoff",
    link: "https://en.wikipedia.org/wiki/Mafia_(party_game)",
    bggId: 925,
  },
  description: `Banish the traitors before they murder everyone.

        Each day, the round table votes to banish one player, and learns
        whether they were faithful or a traitor. Each night, the traitors
        murder a faithful player, or recruit one to their side after losing
        one of their own. Once four or fewer remain, the table can vote to end
        the game, but if a traitor is still among them, the traitors win.
        No moderator needed: the game deals the roles and keeps the night
        secret.`,
  displayUrlHref: "https://www.tannerkrewson.com/traitors/banishment",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://www.tannerkrewson.com/traitors/banishment",
  pictures: [
    "https://www.tannerkrewson.com/traitors/screenshots/banishment-roundtable.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/banishment-banished.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/banishment-night-traitor.jpg",
    "https://www.tannerkrewson.com/traitors/screenshots/banishment-morning.jpg",
  ],
  difficulty: "medium",
  genres: [],
  players: "5-10",
  minPlayers: 5,
  maxPlayers: 10,
  play: { kind: "nova", url: "https://www.tannerkrewson.com/traitors/game-banishment.html" },
};

/**
 * Hosted Nova games: one self-contained HTML file each, fetched by the host
 * when picked and shared with the party like any saved game. To port and
 * list one, see hosted-nova-games.md.
 */
export const NOVA_GAMES: readonly NovaCatalogGame[] = [
  tkSpyfall,
  traitors,
  traitorsBanishment,
  {
    ...drawphoneBase,
    id: "drawphone",
    name: "Drawphone",
    play: { kind: "nova", url: "https://drawphone.tannerkrewson.com/drawphone.html" },
  },
];
