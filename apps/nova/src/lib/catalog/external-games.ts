import type { ExternalCatalogGame, ExternalPlay } from "./types";
import { relayRequest, type RelayEndpointKey } from "./relay";
import { joinRoomUrl, postJson, randomRoomId, rocketcrabUrl, roomField } from "./join-url";

/**
 * External games: each runs on its own server. Room creation runs in the
 * browser, or through the scoped edge relay when the upstream sends no CORS
 * headers. frameOrigins supplies the strict main-origin CSP allowlist
 * (ADR-0001; apps/nova/vite.config.ts).
 */

function origins(displayUrlHref: string, ...extra: string[]): string[] {
  return [...new Set([new URL(displayUrlHref).origin, ...extra])];
}

/**
 * A game whose relay endpoint returns `{ gameCode }` and whose page takes
 * the code as one query parameter on a fixed URL.
 */
function relayCodeGame(input: {
  readonly frameOrigins: readonly string[];
  readonly endpoint: RelayEndpointKey;
  readonly base: string;
  readonly param: string;
  readonly label: string;
}): ExternalPlay {
  return {
    kind: "external",
    frameOrigins: input.frameOrigins,
    // The endpoint sends no CORS headers, so create rooms through the edge relay.
    createRoom: async () => {
      const { gameCode } = await relayRequest<{ gameCode?: string }>(input.endpoint);
      if (typeof gameCode !== "string") {
        throw new Error(`${input.label} didn't return a game code.`);
      }
      return { code: gameCode };
    },
    joinUrl: (room, player) =>
      rocketcrabUrl(input.base, player, { params: { [input.param]: roomField(room, "code") } }),
  };
}

const protobowl: ExternalCatalogGame = {
  id: "protobowl",
  name: "Protobowl",
  author: "Kevin Kwok",
  description: "Quizbowl practice",
  displayUrlHref: "https://protobowl.com/",
  difficulty: "medium",
  genres: ["trivia"],
  players: "1+",
  play: {
    kind: "external",
    frameOrigins: origins("https://protobowl.com/"),
    createRoom: async () => ({ url: `https://protobowl.com/rocketcrab-${randomRoomId()}` }),
    joinUrl: joinRoomUrl,
  },
};

const setwithfriends: ExternalCatalogGame = {
  id: "setwithfriends",
  name: "Set with Friends",
  author: "Eric Zhang & Cynthia Du",
  basedOn: {
    game: "Set",
    author: "Marsha Falco",
    link: "https://www.playmonster.com/product/set/",
    bggId: 1198,
  },
  description: "Find the triplets!",
  displayUrlHref: "https://setwithfriends.com/",
  difficulty: "easy",
  genres: [],
  play: {
    kind: "external",
    frameOrigins: origins("https://setwithfriends.com/"),
    connectOrigins: [
      "https://www.googleapis.com",
      "https://us-central1-setwithfriends.cloudfunctions.net",
    ],
    createRoom: async () => {
      const roomName = `rocketcrab-${Math.random().toString(36).substring(8)}`;
      const auth = await fetch(
        "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyCeKQ4rauZ_fq1rEIPJ8m5XfppwjtmTZBY",
        {
          method: "POST",
          body: JSON.stringify({ returnSecureToken: true }),
          headers: {
            "content-type": "application/json",
            referer: "https://setwithfriends.com/",
          },
        },
      );
      const { idToken } = (await auth.json()) as { idToken?: string };
      if (typeof idToken !== "string") {
        throw new Error("Set with Friends rejected the room request.");
      }
      await fetch("https://us-central1-setwithfriends.cloudfunctions.net/createGame", {
        method: "POST",
        body: JSON.stringify({ data: { gameId: roomName, access: "private" } }),
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
        },
      });
      return { url: `https://setwithfriends.com/room/${roomName}` };
    },
    joinUrl: joinRoomUrl,
  },
};

const drawphoneBase: Omit<ExternalCatalogGame, "id" | "name" | "play"> = {
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
  players: "1+",
  minPlayers: 1,
  maxPlayers: Number.POSITIVE_INFINITY,
};

const drawphoneOrigins = origins(
  "https://drawphone.tannerkrewson.com/",
  "https://dpk.tannerkrewson.com",
);

const drawphone: ExternalCatalogGame = {
  ...drawphoneBase,
  id: "drawphone",
  name: "Drawphone",
  play: relayCodeGame({
    frameOrigins: drawphoneOrigins,
    endpoint: "drawphone-new",
    base: "https://drawphone.tannerkrewson.com/",
    param: "code",
    label: "Drawphone",
  }),
};

const drawphoneKids: ExternalCatalogGame = {
  ...drawphoneBase,
  id: "drawphone-kids",
  name: "Drawphone for Kids",
  description:
    drawphoneBase.description +
    "\n\nNOTE: Age-restricted word packs are removed from Drawphone for Kids. Players can still draw and guess unrestricted.",
  play: relayCodeGame({
    frameOrigins: drawphoneOrigins,
    endpoint: "dpk-new",
    base: "https://dpk.tannerkrewson.com/",
    param: "code",
    label: "Drawphone",
  }),
};

const fishbowl: ExternalCatalogGame = {
  id: "fishbowl",
  name: "Fishbowl",
  author: "Avi Moondra",
  description:
    "Fishbowl is a virtual version of a fun (and mostly hilarious) guessing game, designed for any group of all ages! You'll need at least 4 to play, but it only gets more fun with more players. Hop on a video call, and play through rounds of Taboo, Charades, and Password.",
  displayUrlHref: "https://fishbowl-game.com/",
  donationUrlText: "Buy Avi a coffee!",
  donationUrlHref: "https://www.buymeacoffee.com/fishbowlgame",
  guideUrl: "https://fishbowl-game.com/",
  pictures: [
    "https://i.imgur.com/bWlUX5R.jpg",
    "https://i.imgur.com/YkEzh3q.jpg",
    "https://i.imgur.com/Kj5ZZyV.jpg",
    "https://i.imgur.com/NZB2fGn.jpg",
    "https://i.imgur.com/EgXpK11.jpg",
    "https://i.imgur.com/eY5NF46.jpg",
    "https://i.imgur.com/OtRqoy5.jpg",
    "https://i.imgur.com/DPCalID.jpg",
  ],
  difficulty: "easy",
  genres: [],
  players: "4+",
  play: {
    kind: "external",
    frameOrigins: origins("https://fishbowl-game.com/"),
    connectOrigins: ["https://fishbowl-graphql.onrender.com"],
    createRoom: async () => {
      const newGameUrl = "https://fishbowl-graphql.onrender.com/v1/graphql";
      const {
        data: {
          newGame: { join_code: joinCode },
        },
      } = await postJson<{
        data: { newGame: { join_code: string } };
      }>(newGameUrl, {
        query: "mutation  {\n  newGame {\n    join_code\n  }\n}\n",
        variables: null,
      });
      return { url: `https://fishbowl-game.com/game/${joinCode}/lobby` };
    },
    // Fishbowl reads `hideshare` where other games read `rocketcrab`.
    joinUrl: (room, player) =>
      rocketcrabUrl(roomField(room, "url"), player, { rename: { rocketcrab: "hideshare" } }),
  },
};

const justone: ExternalCatalogGame = {
  id: "justone",
  name: "Just One",
  author: "CJ Quines",
  basedOn: {
    game: "Just One",
    author: "Ludovic Roudy & Bruno Sautter",
    link: "https://justone-the-game.com/?lang=en",
    bggId: 254640,
  },
  description: `Just One is a cooperative party game in which you play
        together to discover as many mystery words as possible. Find the best
        clue to help your teammate. Be unique, as all identical clues will be
        cancelled! Everyone writes one-word clues to help a guesser guess their
        mystery word. The catch: you can't show the guesser clues that two or
        more people write.`,
  displayUrlHref: "https://just1.herokuapp.com/",
  difficulty: "easy",
  genres: [],
  players: "1+",
  pictures: [
    "https://i.imgur.com/KX3Sjsi.jpg",
    "https://i.imgur.com/dDu2mMg.jpg",
    "https://i.imgur.com/tZWRVvu.jpg",
    "https://i.imgur.com/hMeiX8k.jpg",
    "https://i.imgur.com/plGWABz.jpg",
  ],
  play: {
    kind: "external",
    frameOrigins: origins("https://just1.herokuapp.com/"),
    createRoom: async () => ({
      url: `https://just1.herokuapp.com/room/rocketcrab-${randomRoomId()}`,
    }),
    joinUrl: joinRoomUrl,
  },
};

const longwave: ExternalCatalogGame = {
  id: "longwave",
  name: "Longwave",
  author: "Evan Bailey & Margarethe Schoen",
  basedOn: {
    game: "Wavelength",
    author: "Wolfgang Warsch, Alex Hague, & Justin Vickers",
    link: "https://www.wavelength.zone/",
    bggId: 262543,
  },
  description:
    "Wavelength is a social guessing game where two teams compete to read each other's minds. It's a thrilling experience of TALKING and THINKING and HIGH FIVING that anyone can play—but it also has some of that deep word game sorcery, like Codenames, where your decisions feel tense, strategic, meaningful.",
  displayUrlHref: "https://longwave.web.app/",
  difficulty: "easy",
  genres: [],
  players: "2-12+",
  guideUrl: "https://www.ultraboardgames.com/wavelength/game-rules.php",
  pictures: [
    "https://i.imgur.com/yDx8aln.jpg",
    "https://i.imgur.com/JrjlylN.jpg",
    "https://i.imgur.com/57LlwWA.jpg",
    "https://i.imgur.com/cuGMgKv.jpg",
    "https://i.imgur.com/u36UW03.jpg",
  ],
  play: {
    kind: "external",
    frameOrigins: origins("https://longwave.web.app/"),
    createRoom: async () => ({ url: `https://longwave.web.app/rocketcrab-${randomRoomId()}` }),
    joinUrl: joinRoomUrl,
  },
};

/** Room creation redirects to the new room; use the final response URL. */
function netgamesioGame(
  urlId: string,
  {
    name,
    description,
    basedOn,
    difficulty,
    genres,
    players,
    guideUrl,
    pictures,
  }: Pick<
    ExternalCatalogGame,
    | "name"
    | "description"
    | "basedOn"
    | "difficulty"
    | "genres"
    | "players"
    | "guideUrl"
    | "pictures"
  >,
): ExternalCatalogGame {
  return {
    id: `netgamesio-${urlId}`,
    name,
    author: "Luke Tsekouras",
    basedOn,
    description,
    displayUrlHref: "https://netgames.io/",
    donationUrlText: "Buy Luke a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/lukegt",
    difficulty,
    genres,
    players,
    ...(guideUrl ? { guideUrl } : {}),
    ...(pictures ? { pictures } : {}),
    play: {
      kind: "external",
      frameOrigins: origins("https://netgames.io/"),
      // The redirect has no CORS headers; the scoped relay follows it server-side.
      createRoom: async () => {
        const { url } = await relayRequest<{ url: string }>("netgamesio-new", { urlId });
        if (typeof url !== "string") {
          throw new Error("netgames.io couldn't create a room.");
        }
        return { url };
      },
      joinUrl: joinRoomUrl,
    },
  };
}

const netgamesioGames: ExternalCatalogGame[] = [
  netgamesioGame("avalon", {
    name: "Avalon",
    description:
      "The Loyal Servants of Arthur are on a quest for the Holy Grail. However, the evil Minions of Mordred are amidst the good, and they wish to destroy their prize. They are well hidden, and are colluding in secret. Merlin knows where the Evil ones lie, but cannot reveal his knowledge for he will die if they learn his identity. Can the quest succeed despite the treachery afoot?",
    basedOn: {
      game: "The Resistance: Avalon",
      author: "Don Eskridge",
      link: "https://indieboardsandcards.com/index.php/our-games/the-resistance-avalon/",
      bggId: 128882,
    },
    difficulty: "medium",
    genres: [],
    players: "5-10",
    guideUrl: "https://www.ultraboardgames.com/avalon/game-rules.php",
    pictures: [
      "https://i.imgur.com/v8oxIRT.jpg",
      "https://i.imgur.com/WUMpkhM.jpg",
      "https://i.imgur.com/7uOSax6.jpg",
      "https://i.imgur.com/BobyYTI.jpg",
      "https://i.imgur.com/OPmUuiK.jpg",
      "https://i.imgur.com/ROlMAgt.jpg",
    ],
  }),
  netgamesioGame("love-letter", {
    name: "Love Letter",
    description:
      "Love Letter is a game of risk, deduction, and luck for 2–4 players. Your goal is to get your love letter into Princess Annette's hands while deflecting the letters from competing suitors. From a deck with only sixteen cards, each player starts with only one card in hand; one card is removed from play. On a turn, you draw one card, and play one card, trying to expose others and knock them from the game. Powerful cards lead to early gains, but make you a target. Rely on weaker cards for too long, however, and your letter may be tossed in the fire!",
    basedOn: {
      game: "Love Letter",
      author: "Seiji Kanai",
      link: "https://www.zmangames.com/en/games/love-letter/",
      bggId: 129622,
    },
    difficulty: "medium",
    genres: [],
    players: "2-4",
    guideUrl: "https://www.ultraboardgames.com/love-letter/game-rules.php",
    pictures: [
      "https://i.imgur.com/AST27jv.jpg",
      "https://i.imgur.com/h1eLGMu.jpg",
      "https://i.imgur.com/s64xb9b.jpg",
      "https://i.imgur.com/h5KTTlm.jpg",
      "https://i.imgur.com/kTquWLO.jpg",
    ],
  }),
  netgamesioGame("spyfall", {
    name: "Spyfall",
    description:
      "There is a spy among you, and you have met to uncover them. You all share a piece of knowledge: the location of this strange meeting. All except the spy. Use this knowledge to weed the spy out, but don't let them discover your location or the consequences will be dire.",
    basedOn: {
      game: "Spyfall",
      author: "Alexandr Ushan",
      link: "https://www.cryptozoic.com/spyfall",
      bggId: 166384,
    },
    difficulty: "medium",
    genres: [],
    players: "3+",
    guideUrl: "https://www.ultraboardgames.com/spyfall/game-rules.php",
    pictures: [
      "https://i.imgur.com/yW8IO3b.jpg",
      "https://i.imgur.com/qJas8PC.jpg",
      "https://i.imgur.com/NWxJcDq.jpg",
      "https://i.imgur.com/MiNe9cm.jpg",
      "https://i.imgur.com/OIAwn6z.jpg",
      "https://i.imgur.com/qVQv7RH.jpg",
    ],
  }),
  netgamesioGame("secret-hitler", {
    name: "Secret Hitler",
    description:
      "It is pre-war Germany, and the political fight between the Fascists and Liberals is raging. Each party wishes to enact policies in line with their own agenda; if they enact enough, then the country will be under their control. Although the Fascists are outnumbered, they also remain hidden, and none more hidden than Hitler himself. If Hitler is elected Chancellor after only a few Fascist policies are in effect, the Fascists will seize control immediately. The Liberals might have to play dirty in order to stop this, enacting Fascist policies to perform investigations, and even to make an assassination attempt on Hitler himself.",
    basedOn: {
      game: "Secret Hitler",
      author: "Goat, Wolf, & Cabbage LLC",
      link: "https://www.secrethitler.com/",
      bggId: 188834,
    },
    difficulty: "hard",
    genres: [],
    players: "5-10",
    guideUrl: "https://www.ultraboardgames.com/secret-hitler/game-rules.php",
    pictures: [
      "https://i.imgur.com/22vIUhH.jpg",
      "https://i.imgur.com/T35jSu8.jpg",
      "https://i.imgur.com/hp18Ixq.jpg",
      "https://i.imgur.com/KKlKmM1.jpg",
      "https://i.imgur.com/CvFWc9X.jpg",
      "https://i.imgur.com/CNvGgbJ.jpg",
    ],
  }),
  netgamesioGame("codewords", {
    name: "Codewords",
    description:
      "Rival Codebreakers race to identify which of the 25 Codewords are their own. They do this by listening to their Codemasters, who take turns giving one-word clues. The Codebreakers try to guess which words their Codemaster meant, one at a time. If they guess correctly, they may continue guessing until they either run out of ideas for the given clue or get a Codeword wrong. Then it is the other team's turn to give a clue and guess. The first team to reveal all their Codewords wins the game, but don't touch the Corrupted Codeword!",
    basedOn: {
      game: "Codenames",
      author: "Vlaada Chvátil",
      link: "https://codenamesgame.com/",
      bggId: 178900,
    },
    difficulty: "medium",
    genres: [],
    players: "4+",
    guideUrl: "https://www.ultraboardgames.com/codenames/game-rules.php",
    pictures: [
      "https://i.imgur.com/fnrZNkH.jpg",
      "https://i.imgur.com/MaGgXl2.jpg",
      "https://i.imgur.com/LeCRShS.jpg",
      "https://i.imgur.com/lX86Ckk.jpg",
      "https://i.imgur.com/g1aUMBw.jpg",
      "https://i.imgur.com/acBoU7U.jpg",
      "https://i.imgur.com/tgTSLbV.jpg",
    ],
  }),
  netgamesioGame("onu-werewolf", {
    name: "One Night Ultimate Werewolf",
    description:
      "Each player takes on the role of a Villager, a Werewolf, or a special character. It's your job to figure out who the Werewolves are and to kill at least one of them in order to win... unless you've become a Werewolf yourself.",
    basedOn: {
      game: "One Night Ultimate Werewolf",
      author: "Bezier Games",
      link: "https://beziergames.com/collections/all-uw-titles/products/one-night-ultimate-werewolf",
      bggId: 147949,
    },
    difficulty: "medium",
    genres: [],
    players: "3-18",
    guideUrl: "https://www.ultraboardgames.com/one-night-ultimate-werewolf/game-rules.php",
    pictures: [
      "https://i.imgur.com/zkl4wHv.jpg",
      "https://i.imgur.com/wljtGCg.jpg",
      "https://i.imgur.com/sRx8zxd.jpg",
      "https://i.imgur.com/keMR7dH.jpg",
      "https://i.imgur.com/vBDeKsc.jpg",
      "https://i.imgur.com/NBOFU6r.jpg",
      "https://i.imgur.com/p9ZxEhH.jpg",
    ],
  }),
  netgamesioGame("enigma", {
    name: "Enigma",
    description:
      'Two warring factions are trying to send secret messages to their comrades, but their communications are broadcast for the enemy to see. To keep their messages secret, each faction "encrypts" their messages using 4 keywords, known only to their comrades. Meanwhile, the enemy tries to intercept their messages by listening to their clues and figuring out the enemy\'s keywords. The first faction to intercept 2 messages from the other faction wins, unless a faction loses by miscommunicating 2 of their own messages.',
    basedOn: {
      game: "Decrypto",
      author: "Thomas Dagenais-Lespérance",
      link: "https://iellousa.com/products/decrypto",
      bggId: 225694,
    },
    difficulty: "hard",
    genres: [],
    players: "4+",
    guideUrl: "https://www.ultraboardgames.com/enigma/game-rules.php",
    pictures: [
      "https://i.imgur.com/QYstRgP.jpg",
      "https://i.imgur.com/YgLUFYb.jpg",
      "https://i.imgur.com/CoIo6yI.jpg",
      "https://i.imgur.com/416bKnE.jpg",
      "https://i.imgur.com/UjfApw6.jpg",
    ],
  }),
];

/** Create one outofcontext.party room per game; all players share its lobby URL. */
function outOfContextGame(
  game: string,
  {
    name,
    description,
    basedOn,
    difficulty,
    genres,
    players,
    minPlayers,
    pictures,
  }: Pick<
    ExternalCatalogGame,
    | "name"
    | "description"
    | "basedOn"
    | "difficulty"
    | "genres"
    | "players"
    | "minPlayers"
    | "pictures"
  >,
): ExternalCatalogGame {
  const origin = "https://outofcontext.party";
  return {
    id: `ooc-${game}`,
    name,
    author: "Isaac Hirschfeld",
    basedOn,
    description,
    displayUrlHref: origin + "/",
    minPlayers,
    maxPlayers: 255,
    difficulty,
    genres,
    players,
    ...(pictures ? { pictures } : {}),
    play: {
      kind: "external",
      frameOrigins: origins(origin + "/"),
      // The upstream returns no CORS headers, so use the scoped relay.
      createRoom: async () => {
        const { code } = await relayRequest<{ code?: string }>("ooc-rocketcrab", {
          body: { game, version: 1 },
        });
        if (typeof code !== "string") {
          throw new Error("outofcontext.party didn't return a room code.");
        }
        return { url: `${origin}/lobby/${code}` };
      },
      joinUrl: joinRoomUrl,
    },
  };
}

const outOfContextGames: ExternalCatalogGame[] = [
  outOfContextGame("story", {
    name: "Raconteur",
    description: `Collaborate in writing stories one line at a time with
            minimal context.

            Raconteur is inspired by improv-type games where players
            contribute to a story one sentence or one word at a time.
            The idea is to create unique stories from a train of thought
            going who knows where. Continuity is held only by the last line
            in the story, so writing with ambiguity allows for more
            interesting stories.`,
    basedOn: {
      game: "Consequences, FoldingStory",
      link: "https://en.wikipedia.org/wiki/Consequences_(game)",
    },
    difficulty: "easy",
    genres: ["writing"],
    minPlayers: 2,
    players: "2+",
    pictures: [
      "https://i.imgur.com/d3qNPi4.jpg",
      "https://i.imgur.com/yd8klf4.jpg",
      "https://i.imgur.com/gyCBqMh.jpg",
    ],
  }),
  outOfContextGame("redacted", {
    name: "Redacted",
    description: `Collaborate in writing, tampering, and repairing
            stories one line at a time.

            Redacted is an extension upon Raconteur. Players still
            contribute to a story, however now players are able to interact
            with the lines other players have written. This game is meant to
            be played after a familiarity with no context line-by-line
            stories is established.`,
    basedOn: null,
    difficulty: "medium",
    genres: ["writing"],
    minPlayers: 4,
    players: "4+",
    pictures: [
      "https://i.imgur.com/n4QYeLp.jpg",
      "https://i.imgur.com/IQ6DAhF.jpg",
      "https://i.imgur.com/urUahk6.jpg",
      "https://i.imgur.com/QSX70Nv.jpg",
      "https://i.imgur.com/vaIJQwM.jpg",
    ],
  }),
  outOfContextGame("recipe", {
    name: "Hodgepodge",
    description: `Collaborate in splicing together recipes for anything.

            Hodgepodge is fairly complicated in the sense that there is not a
            single streamlined direction for each instruction set. Players
            submit steps in a recipe following a theme, ingredients without
            any context, and potential hazards without context. This mixture
            of randomness and context tends to be awfully delicious.`,
    basedOn: null,
    difficulty: "medium",
    genres: ["writing"],
    minPlayers: 2,
    players: "2+",
    pictures: [
      "https://i.imgur.com/IAC751C.jpg",
      "https://i.imgur.com/BvdwE7v.jpg",
      "https://i.imgur.com/Mezk17h.jpg",
      "https://i.imgur.com/lkD8Xbf.jpg",
      "https://i.imgur.com/a8jCj5t.jpg",
    ],
  }),
];

const qwiqwit: ExternalCatalogGame = {
  id: "qwiqwit",
  name: "QwiqWit",
  author: "Paul Wind & TypesInCode",
  description:
    "In QwiqWit, there's no right or wrong answers. Just enter what you think is funny. Your answers will go head-to-head against other players. The rest of the players in the room will vote on their favorite answer. Be sure to vote! It could be worth extra points (eventually).",
  displayUrlHref: "https://www.qwiqwit.com/",
  donationUrlText: "Buy the developers a coffee!",
  donationUrlHref: "https://www.buymeacoffee.com/qwiqwit",
  difficulty: "easy",
  genres: [],
  players: "3-25",
  pictures: [
    "https://i.imgur.com/5mX4zf7.jpg",
    "https://i.imgur.com/cPZFcYr.jpg",
    "https://i.imgur.com/690VrZJ.jpg",
    "https://i.imgur.com/X4BZKmA.jpg",
  ],
  play: {
    kind: "external",
    frameOrigins: origins("https://www.qwiqwit.com/"),
    createRoom: async () => ({ url: `https://www.qwiqwit.com/autojoin/${randomRoomId()}` }),
    joinUrl: joinRoomUrl,
  },
};

const secrethitlerDuc: ExternalCatalogGame = {
  id: "secrethitler-duc",
  name: "Secret Hitler",
  author: "Duc Ngo Viet",
  basedOn: {
    game: "Secret Hitler",
    author: "Goat, Wolf, & Cabbage LLC",
    link: "https://www.secrethitler.com/",
    bggId: 188834,
  },
  description:
    "Secret Hitler is a social deduction game for 5-10 people about finding and stopping the Secret Hitler. Players are secretly divided into two teams: the liberals, who have a majority, and the fascists, who are hidden to everyone but each other. If the liberals can learn to trust each other, they have enough votes to control the elections and save the day. But the fascists will say whatever it takes to get elected, advance their agenda, and win the game.",
  displayUrlHref: "https://secret-hitler.com/",
  donationUrlText: "Buy ducci a coffee!",
  donationUrlHref: "https://www.buymeacoffee.com/ducci",
  guideUrl: "https://www.ultraboardgames.com/secret-hitler/game-rules.php",
  pictures: [
    "https://i.imgur.com/1WunWnQ.jpg",
    "https://i.imgur.com/qGLaOnR.jpg",
    "https://i.imgur.com/dZ0J1GS.jpg",
    "https://i.imgur.com/W6T40Ot.jpg",
  ],
  difficulty: "hard",
  genres: [],
  players: "5-10",
  minPlayers: 5,
  maxPlayers: 10,
  play: relayCodeGame({
    frameOrigins: origins("https://secret-hitler.com/"),
    endpoint: "secret-hitler-netlify",
    base: "https://secret-hitler.com/",
    param: "roomId",
    label: "Secret Hitler",
  }),
};

const snakeout: ExternalCatalogGame = {
  id: "snakeout",
  name: "Snakeout",
  author: "Tanner Krewson",
  basedOn: {
    game: "The Resistance",
    author: "Don Eskridge",
    link: "https://indieboardsandcards.com/index.php/our-games/the-resistance/",
    bggId: 41114,
  },
  description: `Out the snake, or be outed as a snake! 🐍

        Snakeout is a game in which a team of loyalists is infiltrated by a
        group of snakes. The loyalists must try to figure out who the snakes
        are, and the snakes must try to keep the loyalists from figuring out
        their identity. The game is separated into five missions. The first
        team to "win" three missions wins the game.`,
  displayUrlHref: "https://snakeout.tannerkrewson.com/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://snakeout.tannerkrewson.com/how-to-play",
  pictures: [
    "https://i.imgur.com/Doo5X0p.jpg",
    "https://i.imgur.com/YH0zR3c.jpg",
    "https://i.imgur.com/1Xf8j0g.jpg",
    "https://i.imgur.com/ET1S3Ff.jpg",
    "https://i.imgur.com/w568hdf.jpg",
    "https://i.imgur.com/00tlDOB.jpg",
  ],
  difficulty: "medium",
  genres: [],
  players: "5-10",
  play: relayCodeGame({
    frameOrigins: origins("https://snakeout.tannerkrewson.com/"),
    endpoint: "snakeout-new",
    base: "https://snakeout.tannerkrewson.com/",
    param: "code",
    label: "Snakeout",
  }),
};

const tkSpyfall: ExternalCatalogGame = {
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
  displayUrlHref: "https://spyfall.tannerkrewson.com/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://spyfall.tannerkrewson.com/how-to-play",
  difficulty: "medium",
  genres: [],
  players: "4+",
  minPlayers: 1,
  maxPlayers: Number.POSITIVE_INFINITY,
  pictures: ["https://i.imgur.com/gAYGUUC.jpg", "https://i.imgur.com/8VMpYns.jpg"],
  play: {
    kind: "external",
    frameOrigins: origins("https://spyfall.tannerkrewson.com/"),
    // Room creation sends no CORS headers, so use the scoped relay.
    createRoom: async () => {
      const { gameCode } = await relayRequest<{ gameCode?: string }>("spyfall-new");
      if (typeof gameCode !== "string") {
        throw new Error("Spyfall didn't return a game code.");
      }
      return { url: `https://spyfall.tannerkrewson.com/${gameCode}` };
    },
    joinUrl: joinRoomUrl,
  },
};

const werewolfnight: ExternalCatalogGame = {
  id: "werewolfnight",
  name: "werewolf-night.com",
  author: "Duc Ngo Viet",
  basedOn: {
    game: "Mafia",
    author: "Dimitry Davidoff",
    link: "https://en.wikipedia.org/wiki/Mafia_(party_game)",
    bggId: 925,
  },
  description: `Werewolf-night is an interactive deduction game for
    two teams: the villagers and the werewolves.
    While the villagers do not know who the werewolves are, the werewolves try to remain undiscovered
    and eliminate one villager after the other.
    one by one...`,
  displayUrlHref: "https://werewolf-night.com/",
  donationUrlText: "Buy ducci a coffee!",
  donationUrlHref: "https://www.buymeacoffee.com/ducci",
  guideUrl: "https://werewolf-night.com/roles",
  pictures: [
    "https://i.imgur.com/A7yqerc.jpg",
    "https://i.imgur.com/He5amxk.jpg",
    "https://i.imgur.com/96lH5JJ.jpg",
    "https://i.imgur.com/17PUnb0.jpg",
  ],
  difficulty: "hard",
  genres: [],
  players: "5-16",
  minPlayers: 5,
  maxPlayers: 16,
  play: relayCodeGame({
    frameOrigins: origins("https://werewolf-night.com/"),
    endpoint: "werewolf-newroom",
    base: "https://werewolf-night.com/game",
    param: "roomId",
    label: "werewolf-night.com",
  }),
};

export const EXTERNAL_GAMES: readonly ExternalCatalogGame[] = [
  protobowl,
  setwithfriends,
  drawphone,
  drawphoneKids,
  fishbowl,
  justone,
  longwave,
  ...netgamesioGames,
  ...outOfContextGames,
  qwiqwit,
  secrethitlerDuc,
  snakeout,
  tkSpyfall,
  werewolfnight,
];
