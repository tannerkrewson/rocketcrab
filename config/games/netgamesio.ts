import { ServerGame } from "../../types/types";

const gameTemplate = (
    urlId: string,
    {
        name,
        description,
        basedOn,
        category,
        players,
        familyFriendly,
        guideUrl,
        guideId,
        pictures,
    }: Partial<ServerGame>
): ServerGame => ({
    id: "netgamesio-" + urlId,
    name: name,
    author: "Luke Tsekouras",
    basedOn,
    description,
    displayUrlText: "netgames.io",
    displayUrlHref: "https://netgames.io/",
    donationUrlText: "Buy Luke a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/lukegt",
    category,
    players,
    familyFriendly,
    pictures,
    ...(guideUrl ? { guideUrl } : {}),
    ...(guideId ? { guideId } : {}),
    connectToGame: async () => {
        const newGame = await fetch(
            "https://netgames.io/games/" + urlId + "/new"
        );
        return {
            playerURL: newGame.url,
        };
    },
});

const games: Array<ServerGame> = [
    gameTemplate("avalon", {
        name: "Avalon",
        description:
            "The Loyal Servants of Arthur are on a quest for the Holy Grail. However, the evil Minions of Mordred are amidst the good, and they wish to destroy their prize. They are well hidden, and are colluding in secret. Merlin knows where the Evil ones lie, but cannot reveal his knowledge for he will die if they learn his identity. Can the quest succeed despite the treachery afoot?",
        basedOn: {
            game: "Avalon",
            author: "Don Eskridge",
            link:
                "https://www.amazon.com/Resistance-Avalon-Social-Deduction-Game/dp/B009SAAV0C",
        },
        category: ["netgamesio", "medium"],
        players: "5-10",
        familyFriendly: true,
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
    gameTemplate("love-letter", {
        name: "Love Letter",
        description:
            "Love Letter is a game of risk, deduction, and luck for 2–4 players. Your goal is to get your love letter into Princess Annette's hands while deflecting the letters from competing suitors. From a deck with only sixteen cards, each player starts with only one card in hand; one card is removed from play. On a turn, you draw one card, and play one card, trying to expose others and knock them from the game. Powerful cards lead to early gains, but make you a target. Rely on weaker cards for too long, however, and your letter may be tossed in the fire!",
        basedOn: {
            game: "Love Letter",
            author: "Seiji Kanai",
            link: "https://www.zmangames.com/en/games/love-letter/",
        },
        category: ["netgamesio", "medium"],
        players: "2-4",
        familyFriendly: true,
        pictures: [
            "https://i.imgur.com/AST27jv.jpg",
            "https://i.imgur.com/h1eLGMu.jpg",
            "https://i.imgur.com/s64xb9b.jpg",
            "https://i.imgur.com/h5KTTlm.jpg",
            "https://i.imgur.com/kTquWLO.jpg",
        ],
        guideUrl: "https://www.ultraboardgames.com/love-letter/game-rules.php",
    }),
    gameTemplate("spyfall", {
        name: "Spyfall",
        description:
            "There is a spy among you, and you have met to uncover them. You all share a piece of knowledge: the location of this strange meeting. All except the spy. Use this knowledge to weed the spy out, but don't let them discover your location or the consequences will be dire.",
        basedOn: {
            game: "Spyfall",
            author: "Alexandr Ushan",
            link: "https://www.cryptozoic.com/spyfall",
        },
        category: ["netgamesio", "medium"],
        players: "3+",
        familyFriendly: true,
        guide: "spyfall",
        pictures: [
            "https://i.imgur.com/yW8IO3b.jpg",
            "https://i.imgur.com/qJas8PC.jpg",
            "https://i.imgur.com/NWxJcDq.jpg",
            "https://i.imgur.com/MiNe9cm.jpg",
            "https://i.imgur.com/OIAwn6z.jpg",
            "https://i.imgur.com/qVQv7RH.jpg",
        ],
    }),
    gameTemplate("secret-hitler", {
        name: "Secret Hitler",
        description:
            "It is pre-war Germany, and the political fight between the Fascists and Liberals is raging. Each party wishes to enact policies in line with their own agenda; if they enact enough, then the country will be under their control. Although the Fascists are outnumbered, they also remain hidden, and none more hidden than Hitler himself. If Hitler is elected Chancellor after only a few Fascist policies are in effect, the Fascists will seize control immediately. The Liberals might have to play dirty in order to stop this, enacting Fascist policies to perform investigations, and even to make an assassination attempt on Hitler himself..",
        basedOn: {
            game: "Secret Hitler",
            author: "Goat, Wolf, & Cabbage LLC",
            link: "https://www.secrethitler.com/",
        },
        category: ["netgamesio", "hard"],
        players: "5-10",
        familyFriendly: true,
        guideUrl:
            "https://www.ultraboardgames.com/secret-hitler/game-rules.php",
        pictures: [
            "https://i.imgur.com/22vIUhH.jpg",
            "https://i.imgur.com/T35jSu8.jpg",
            "https://i.imgur.com/hp18Ixq.jpg",
            "https://i.imgur.com/KKlKmM1.jpg",
            "https://i.imgur.com/CvFWc9X.jpg",
            "https://i.imgur.com/CNvGgbJ.jpg",
        ],
    }),
    gameTemplate("codewords", {
        name: "Codewords",
        description:
            "Rival Codebreakers race to identify which of the 25 Codewords are their own. They do this by listening to their Codemasters, who take turns giving one-word clues. The Codebreakers try to guess which words their Codemaster meant, one at a time. If they guess correctly, they may continue guessing until they either run out of ideas for the given clue or get a Codeword wrong. Then it is the other team's turn to give a clue and guess. The first team to reveal all their Codewords wins the game, but don't touch the Corrupted Codeword!",
        basedOn: {
            game: "Codenames",
            author: "Vlaada Chvátil",
            link: "https://codenamesgame.com/",
        },
        category: ["netgamesio", "medium"],
        players: "4+",
        familyFriendly: true,
        guideId: "codenames",
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
    gameTemplate("onu-werewolf", {
        name: "One Night Ultimate Werewolf",
        description:
            "Each player takes on the role of a Villager, a Werewolf, or a special character. It’s your job to figure out who the Werewolves are and to kill at least one of them in order to win... unless you’ve become a Werewolf yourself.",
        basedOn: {
            game: "One Night Ultimate Werewolf",
            author: "Bezier Games",
            link:
                "https://beziergames.com/collections/all-uw-titles/products/one-night-ultimate-werewolf",
        },
        category: ["netgamesio", "medium"],
        players: "3-18",
        familyFriendly: true,
        guideUrl:
            "https://www.ultraboardgames.com/one-night-ultimate-werewolf/game-rules.php",
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
    gameTemplate("enigma", {
        name: "Enigma",
        description:
            'Two warring factions are trying to send secret messages to their comrades, but their communications are broadcast for the enemy to see. To keep their messages secret, each faction "encrypts" their messages using 4 keywords, known only to their comrades. Meanwhile, the enemy tries to intercept their messages by listening to their clues and figuring out the enemy\'s keywords. The first faction to intercept 2 messages from the other faction wins, unless a faction loses by miscommunicating 2 of their own messages.',
        basedOn: {
            game: "Decrypto",
            author: "Thomas Dagenais-Lespérance",
            link:
                "https://www.amazon.com/IELLO-IEL00072-Decrypto-Board-Game/dp/B0765KL7B8",
        },
        category: ["netgamesio", "hard"],
        players: "4+",
        familyFriendly: true,
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

export default games;
