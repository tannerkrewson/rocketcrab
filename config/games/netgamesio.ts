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
    getJoinGameUrl: async () => {
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
            "Evil players try to sabotage the good as they undertake quests for the Holy Grail.",
        basedOn: {
            game: "Avalon",
            author: "Don Eskridge",
            link:
                "https://www.amazon.com/Resistance-Avalon-Social-Deduction-Game/dp/B009SAAV0C",
        },
        category: ["netgamesio", "medium"],
        players: "5-10",
        familyFriendly: true,
    }),
    gameTemplate("love-letter", {
        name: "Love Letter",
        description:
            "Compete for the heart of the Princess through deception and betrayal.",
        basedOn: {
            game: "Love Letter",
            author: "Seiji Kanai",
            link: "https://www.zmangames.com/en/games/love-letter/",
        },
        category: ["netgamesio", "medium"],
        players: "2-4",
        familyFriendly: true,
    }),
    gameTemplate("spyfall", {
        name: "Spyfall",
        description:
            "Discover who the spy is by asking careful questions, but don't let them know too much.",
        basedOn: {
            game: "Spyfall",
            author: "Alexandr Ushan",
            link: "https://www.cryptozoic.com/spyfall",
        },
        category: ["netgamesio", "medium"],
        players: "3+",
        familyFriendly: true,
    }),
    gameTemplate("secret-hitler", {
        name: "Secret Hitler",
        description:
            "The Liberals and the Fascists fight for political power in pre-war Germany.",
        basedOn: {
            game: "Secret Hitler",
            author: "Goat, Wolf, & Cabbage LLC",
            link: "https://www.secrethitler.com/",
        },
        category: ["netgamesio", "hard"],
        players: "5-10",
        familyFriendly: true,
    }),
    gameTemplate("codewords", {
        name: "Codewords",
        description:
            "Rival Codebreakers try to identify their Codewords before the enemy discovers theirs.",
        basedOn: {
            game: "Codenames",
            author: "Vlaada Chvátil",
            link: "https://codenamesgame.com/",
        },
        category: ["netgamesio", "medium"],
        players: "4+",
        familyFriendly: true,
    }),
    gameTemplate("onu-werewolf", {
        name: "One Night Ultimate Werewolf",
        description:
            "Find the Werewolves hiding amongst you, but you only have one night.",
        basedOn: {
            game: "One Night Ultimate Werewolf",
            author: "Bezier Games",
            link:
                "https://beziergames.com/collections/all-uw-titles/products/one-night-ultimate-werewolf",
        },
        category: ["netgamesio", "medium"],
        players: "3-18",
        familyFriendly: true,
    }),
    gameTemplate("enigma", {
        name: "Enigma",
        description:
            "Send secret messages to your comrades while intercepting those of your enemy.",
        basedOn: {
            game: "Decrypto",
            author: "Thomas Dagenais-Lespérance",
            link:
                "https://www.amazon.com/IELLO-IEL00072-Decrypto-Board-Game/dp/B0765KL7B8",
        },
        category: ["netgamesio", "hard"],
        players: "4+",
        familyFriendly: true,
    }),
];

export default games;
