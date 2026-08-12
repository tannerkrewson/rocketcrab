import type { ClassicGame } from "./types";
import { relayConfigured, relayRequest } from "./relay";
import { postJson, randomRoomId } from "./url";

/**
 * The whole classic Rocketcrab external iframe game list (rocketcrab-9fv.7.7.1),
 * ported from the dev branch `config/games/*`. Each game's room-creation flow
 * (classic's server-side `connectToGame`) is preserved verbatim in spirit,
 * adapted to run client-side in the browser (Nova is backendless).
 *
 * `frameOrigins` feeds the main origin's CSP `frame-src` allowlist (see
 * apps/nova/vite.config.ts) — the strict CSP (ADR-0001) otherwise blocks
 * these external iframes.
 */

/** Unique origins from a display URL plus any extra iframe origins. */
function origins(displayUrlHref: string, ...extra: string[]): string[] {
  return [...new Set([new URL(displayUrlHref).origin, ...extra])];
}

const protobowl: ClassicGame = {
  id: "protobowl",
  kind: "classic",
  name: "Protobowl",
  author: "Kevin Kwok",
  description: "Quizbowl practice",
  displayUrlText: "protobowl.com",
  displayUrlHref: "https://protobowl.com/",
  category: ["trivia", "medium"],
  players: "1+",
  frameOrigins: origins("https://protobowl.com/"),
  connectToGame: async () => ({
    player: { url: `https://protobowl.com/rocketcrab-${randomRoomId()}` },
  }),
};

const setwithfriends: ClassicGame = {
  id: "setwithfriends",
  kind: "classic",
  name: "Set with Friends",
  author: "Eric Zhang & Cynthia Du",
  basedOn: {
    game: "Set",
    author: "Marsha Falco",
    link: "https://www.playmonster.com/product/set/",
    bggId: 1198,
  },
  description: "Find the triplets!",
  displayUrlText: "setwithfriends.com",
  displayUrlHref: "https://setwithfriends.com/",
  category: ["easy"],
  frameOrigins: origins("https://setwithfriends.com/"),
  connectToGame: async () => {
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
    return { player: { url: `https://setwithfriends.com/room/${roomName}` } };
  },
};

const drawphoneBase: Omit<ClassicGame, "id" | "name" | "frameOrigins" | "connectToGame"> = {
  kind: "classic",
  author: "Tanner Krewson",
  description: `In Drawphone, there are no winners... only losers! Players
        take turns drawing pictures and guessing what those pictures are. If
        you guess correctly, nothing happens! If you guess wrong or draw like a
        toddler and ruin the chain of drawings and guesses, rest assured that
        you will be mercilessly mocked for your honest mistake (which
        ultimately doesn't even matter in the grand scheme of the world).

        Drawphone was inspired by Evan Brumley's 2015 online Spyfall
        implementation, Jackbox Games's Drawful, and Telestrations.`,
  displayUrlText: "drawphone.tannerkrewson.com",
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
  category: ["drawing", "easy"],
  players: "1+",
  minPlayers: 1,
  maxPlayers: Number.POSITIVE_INFINITY,
};

const drawphoneConnect =
  (baseUrl: string, relayEndpoint: string) =>
  async (): Promise<{ player: { url: string; customQueryParams: { code: string } } }> => {
    // CORS-blocked endpoint (7.7.3): once the scoped relay is deployed and
    // VITE_CLASSIC_RELAY_ORIGIN is set, create the room through it; until
    // then keep the direct fetch (whose CORS failure is documented in the
    // browse UI as "room creation blocked").
    const { gameCode } = relayConfigured()
      ? await relayRequest<{ gameCode?: string }>(relayEndpoint)
      : await postJson<{ gameCode?: string }>(baseUrl + "new");
    if (typeof gameCode !== "string") {
      throw new Error("Drawphone didn't return a game code.");
    }
    return {
      player: {
        url: baseUrl,
        customQueryParams: { code: gameCode },
      },
    };
  };

const drawphone: ClassicGame = {
  ...drawphoneBase,
  id: "drawphone",
  name: "Drawphone",
  frameOrigins: origins("https://drawphone.tannerkrewson.com/", "https://dpk.tannerkrewson.com"),
  // Verified CORS-blocked: /new returns 200 with no Access-Control-Allow-Origin (7.7.3).
  connectStatus: "blocked",
  connectToGame: drawphoneConnect("https://drawphone.tannerkrewson.com/", "drawphone-new"),
};

const drawphoneKids: ClassicGame = {
  ...drawphoneBase,
  id: "drawphone-kids",
  name: "Drawphone for Kids",
  description:
    drawphoneBase.description +
    "\n\nNOTE: Age-restricted word packs are removed from Drawphone for Kids. Players can still draw and guess unrestricted.",
  frameOrigins: origins("https://drawphone.tannerkrewson.com/", "https://dpk.tannerkrewson.com"),
  connectStatus: "blocked",
  connectToGame: drawphoneConnect("https://dpk.tannerkrewson.com/", "dpk-new"),
};

const fishbowl: ClassicGame = {
  id: "fishbowl",
  kind: "classic",
  name: "Fishbowl",
  author: "Avi Moondra",
  description:
    "Fishbowl is a virtual version of a fun (and mostly hilarious) guessing game, designed for any group of all ages! You'll need at least 4 to play, but it only gets more fun with more players. Hop on a video call, and play through rounds of Taboo, Charades, and Password.",
  displayUrlText: "fishbowl-game.com",
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
  category: ["easy"],
  players: "4+",
  renameParams: { rocketcrab: "hideshare" },
  frameOrigins: origins("https://fishbowl-game.com/"),
  connectToGame: async () => {
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
    return {
      player: { url: `https://fishbowl-game.com/game/${joinCode}/lobby` },
    };
  },
};

const justone: ClassicGame = {
  id: "justone",
  kind: "classic",
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
  displayUrlText: "just1.herokuapp.com",
  displayUrlHref: "https://just1.herokuapp.com/",
  category: ["easy"],
  players: "1+",
  pictures: [
    "https://i.imgur.com/KX3Sjsi.jpg",
    "https://i.imgur.com/dDu2mMg.jpg",
    "https://i.imgur.com/tZWRVvu.jpg",
    "https://i.imgur.com/hMeiX8k.jpg",
    "https://i.imgur.com/plGWABz.jpg",
  ],
  frameOrigins: origins("https://just1.herokuapp.com/"),
  connectToGame: async () => ({
    player: { url: `https://just1.herokuapp.com/room/rocketcrab-${randomRoomId()}` },
  }),
};

const longwave: ClassicGame = {
  id: "longwave",
  kind: "classic",
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
  displayUrlText: "longwave.web.app",
  displayUrlHref: "https://longwave.web.app/",
  category: ["easy"],
  players: "2-12+",
  guideUrl: "https://www.ultraboardgames.com/wavelength/game-rules.php",
  pictures: [
    "https://i.imgur.com/yDx8aln.jpg",
    "https://i.imgur.com/JrjlylN.jpg",
    "https://i.imgur.com/57LlwWA.jpg",
    "https://i.imgur.com/cuGMgKv.jpg",
    "https://i.imgur.com/u36UW03.jpg",
  ],
  frameOrigins: origins("https://longwave.web.app/"),
  connectToGame: async () => ({
    player: { url: `https://longwave.web.app/rocketcrab-${randomRoomId()}` },
  }),
};

/**
 * netgames.io games (dev branch `config/games/netgamesio.ts`). Classic
 * fetched the room-creation URL and used the final response URL as the room
 * (the endpoint redirects to the created room).
 */
function netgamesioGame(
  urlId: string,
  {
    name,
    description,
    basedOn,
    category,
    players,
    guideUrl,
    pictures,
  }: Pick<
    ClassicGame,
    "name" | "description" | "basedOn" | "category" | "players" | "guideUrl" | "pictures"
  >,
): ClassicGame {
  return {
    id: `netgamesio-${urlId}`,
    kind: "classic",
    name,
    author: "Luke Tsekouras",
    basedOn,
    description,
    displayUrlText: "netgames.io",
    displayUrlHref: "https://netgames.io/",
    donationUrlText: "Buy Luke a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/lukegt",
    category,
    players,
    ...(guideUrl ? { guideUrl } : {}),
    ...(pictures ? { pictures } : {}),
    frameOrigins: origins("https://netgames.io/"),
    // netgames.io /new 302-redirects with no Access-Control-Allow-Origin, so
    // the room-creation fetch is CORS-blocked from the browser (7.7.3). Once
    // the scoped relay is configured, the redirect is followed server-side
    // and the final room URL is returned.
    connectStatus: "blocked",
    connectToGame: async () => {
      if (relayConfigured()) {
        const { url } = await relayRequest<{ url: string }>("netgamesio-new", { urlId });
        if (typeof url !== "string") {
          throw new Error("netgames.io couldn't create a room.");
        }
        return { player: { url } };
      }
      const res = await fetch(`https://netgames.io/games/${urlId}/new`);
      if (!res.ok) {
        throw new Error(`netgames.io couldn't create a room (HTTP ${res.status}).`);
      }
      // The endpoint redirects to the new room; the final response URL is the room.
      return { player: { url: res.url } };
    },
  };
}

const netgamesioGames: ClassicGame[] = [
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
    category: ["netgamesio", "medium"],
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
    category: ["netgamesio", "medium"],
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
    category: ["netgamesio", "medium"],
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
    category: ["netgamesio", "hard"],
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
    category: ["netgamesio", "medium"],
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
    category: ["netgamesio", "medium"],
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
    category: ["netgamesio", "hard"],
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

/**
 * outofcontext.party games (dev branch `config/games/outofcontextparty.ts`).
 * A room is created per game via the site's rocketcrab API; every player
 * joins the same lobby URL.
 */
function outOfContextGame(
  game: string,
  {
    name,
    description,
    basedOn,
    category,
    players,
    minPlayers,
    pictures,
  }: Pick<
    ClassicGame,
    "name" | "description" | "basedOn" | "category" | "players" | "minPlayers" | "pictures"
  >,
): ClassicGame {
  const origin = "https://outofcontext.party";
  return {
    id: `ooc-${game}`,
    kind: "classic",
    name,
    author: "Isaac Hirschfeld",
    basedOn,
    description,
    displayUrlText: "outofcontext.party",
    displayUrlHref: origin + "/",
    minPlayers,
    maxPlayers: 255,
    category,
    players,
    ...(pictures ? { pictures } : {}),
    frameOrigins: origins(origin + "/"),
    // outofcontext.party/api/v1/rocketcrab returns 403 with no CORS headers (7.7.3).
    connectStatus: "blocked",
    connectToGame: async () => {
      const { code } = relayConfigured()
        ? await relayRequest<{ code?: string }>("ooc-rocketcrab", {
            body: { game, version: 1 },
          })
        : await postJson<{ code?: string }>(`${origin}/api/v1/rocketcrab`, {
            game,
            version: 1,
          });
      if (typeof code !== "string") {
        throw new Error("outofcontext.party didn't return a room code.");
      }
      return { player: { url: `${origin}/lobby/${code}` } };
    },
  };
}

const outOfContextGames: ClassicGame[] = [
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
    category: ["writing", "easy"],
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
    category: ["writing", "medium"],
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
    category: ["writing", "medium"],
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

const qwiqwit: ClassicGame = {
  id: "qwiqwit",
  kind: "classic",
  name: "QwiqWit",
  author: "Paul Wind & TypesInCode",
  description:
    "In QwiqWit, there's no right or wrong answers. Just enter what you think is funny. Your answers will go head-to-head against other players. The rest of the players in the room will vote on their favorite answer. Be sure to vote! It could be worth extra points (eventually).",
  displayUrlText: "qwiqwit.com",
  displayUrlHref: "https://www.qwiqwit.com/",
  donationUrlText: "Buy the developers a coffee!",
  donationUrlHref: "https://www.buymeacoffee.com/qwiqwit",
  category: ["easy"],
  players: "3-25",
  pictures: [
    "https://i.imgur.com/5mX4zf7.jpg",
    "https://i.imgur.com/cPZFcYr.jpg",
    "https://i.imgur.com/690VrZJ.jpg",
    "https://i.imgur.com/X4BZKmA.jpg",
  ],
  frameOrigins: origins("https://www.qwiqwit.com/"),
  connectToGame: async () => ({
    player: { url: `https://www.qwiqwit.com/autojoin/${randomRoomId()}` },
  }),
};

const secrethitlerDuc: ClassicGame = {
  id: "secrethitler-duc",
  kind: "classic",
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
  displayUrlText: "secret-hitler.com",
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
  category: ["hard"],
  players: "5-10",
  minPlayers: 5,
  maxPlayers: 10,
  frameOrigins: origins("https://secret-hitler.com/"),
  // netlify function returns 200 with no CORS headers (7.7.3).
  connectStatus: "blocked",
  connectToGame: async () => {
    const newUrl = "https://inspiring-hugle-c583a0.netlify.app/.netlify/functions/secretHitler";
    const { gameCode } = relayConfigured()
      ? await relayRequest<{ gameCode?: string }>("secret-hitler-netlify")
      : await postJson<{ gameCode?: string }>(newUrl);
    if (typeof gameCode !== "string") {
      throw new Error("Secret Hitler didn't return a room code.");
    }
    return {
      player: {
        url: "https://secret-hitler.com/",
        customQueryParams: { roomId: gameCode },
      },
    };
  },
};

const snakeout: ClassicGame = {
  id: "snakeout",
  kind: "classic",
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
  displayUrlText: "snakeout.tannerkrewson.com",
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
  category: ["medium"],
  players: "5-10",
  frameOrigins: origins("https://snakeout.tannerkrewson.com/"),
  // snakeout.tannerkrewson.com/new returns 200 with no CORS headers (7.7.3).
  connectStatus: "blocked",
  connectToGame: async () => {
    const newUrl = "https://snakeout.tannerkrewson.com/new";
    const { gameCode } = relayConfigured()
      ? await relayRequest<{ gameCode?: string }>("snakeout-new")
      : await postJson<{ gameCode?: string }>(newUrl);
    if (typeof gameCode !== "string") {
      throw new Error("Snakeout didn't return a room code.");
    }
    return {
      player: {
        url: "https://snakeout.tannerkrewson.com/",
        customQueryParams: { code: gameCode },
      },
    };
  },
};

const tkSpyfall: ClassicGame = {
  id: "tk-spyfall",
  kind: "classic",
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
  displayUrlText: "spyfall.tannerkrewson.com",
  displayUrlHref: "https://spyfall.tannerkrewson.com/",
  donationUrlText: "Buy Tanner a taco!",
  donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
  guideUrl: "https://spyfall.tannerkrewson.com/how-to-play",
  category: ["medium"],
  players: "4+",
  minPlayers: 1,
  maxPlayers: Number.POSITIVE_INFINITY,
  pictures: ["https://i.imgur.com/gAYGUUC.jpg", "https://i.imgur.com/8VMpYns.jpg"],
  frameOrigins: origins("https://spyfall.tannerkrewson.com/"),
  // spyfall.tannerkrewson.com/new returns 200 with no CORS headers (7.7.3).
  connectStatus: "blocked",
  connectToGame: async () => {
    const newUrl = "https://spyfall.tannerkrewson.com/new";
    const { gameCode } = relayConfigured()
      ? await relayRequest<{ gameCode?: string }>("spyfall-new")
      : await postJson<{ gameCode?: string }>(newUrl);
    if (!gameCode) throw new Error("Failed to create Spyfall game");
    return { player: { url: `https://spyfall.tannerkrewson.com/${gameCode}` } };
  },
};

const werewolfnight: ClassicGame = {
  id: "werewolfnight",
  kind: "classic",
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
  displayUrlText: "werewolf-night.com",
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
  category: ["hard"],
  players: "5-16",
  minPlayers: 5,
  maxPlayers: 16,
  frameOrigins: origins("https://werewolf-night.com/"),
  // werewolf.uber.space/newRoom returns 200 with no CORS headers (7.7.3).
  connectStatus: "blocked",
  connectToGame: async () => {
    const newUrl = "https://werewolf.uber.space/newRoom";
    const { gameCode } = relayConfigured()
      ? await relayRequest<{ gameCode?: string }>("werewolf-newroom")
      : await postJson<{ gameCode?: string }>(newUrl);
    if (typeof gameCode !== "string") {
      throw new Error("werewolf-night.com didn't return a room code.");
    }
    return {
      player: {
        url: "https://werewolf-night.com/game",
        customQueryParams: { roomId: gameCode },
      },
    };
  },
};

/** The full classic game list, one entry per game on classic rocketcrab. */
export const CLASSIC_GAMES: readonly ClassicGame[] = [
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

/** Unique iframe origins across all classic games (CSP frame-src allowlist). */
export const CLASSIC_FRAME_ORIGINS: readonly string[] = [
  ...new Set(CLASSIC_GAMES.flatMap((game) => game.frameOrigins)),
];

/** Look up a classic game by id; undefined when unknown. */
export function findClassicGame(id: string): ClassicGame | undefined {
  return CLASSIC_GAMES.find((game) => game.id === id);
}
