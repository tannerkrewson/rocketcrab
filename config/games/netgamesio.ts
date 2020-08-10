import { ServerGame } from "../../types/types";

const gameTemplate = (
    urlId: string,
    {
        name,
        description,
        category,
        players,
        familyFriendly,
    }: Partial<ServerGame>
): ServerGame => ({
    id: "netgamesio-" + urlId,
    name: name,
    author: "Luke Tsekouras",
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
        category: ["netgamesio", "medium"],
        players: "5-10",
        familyFriendly: true,
    }),
    gameTemplate("love-letter", {
        name: "Love Letter",
        description:
            "Compete for the heart of the Princess through deception and betrayal.",
        category: ["netgamesio", "medium"],
        players: "2-4",
        familyFriendly: true,
    }),
    gameTemplate("spyfall", {
        name: "Spyfall",
        description:
            "Discover who the spy is by asking careful questions, but don't let them know too much.",
        category: ["netgamesio", "medium"],
        players: "3+",
        familyFriendly: true,
    }),
    gameTemplate("secret-hitler", {
        name: "Secret Hitler",
        description:
            "The Liberals and the Fascists fight for political power in pre-war Germany.",
        category: ["netgamesio", "hard"],
        players: "5-10",
        familyFriendly: true,
    }),
    gameTemplate("codewords", {
        name: "Codewords",
        description:
            "Rival Codebreakers try to identify their Codewords before the enemy discovers theirs.",
        category: ["netgamesio", "medium"],
        players: "4+",
        familyFriendly: true,
    }),
    gameTemplate("onu-werewolf", {
        name: "One Night Ultimate Werewolf",
        description:
            "Find the Werewolves hiding amongst you, but you only have one night.",
        category: ["netgamesio", "medium"],
        players: "3-18",
        familyFriendly: true,
    }),
    gameTemplate("enigma", {
        name: "Enigma",
        description:
            "Send secret messages to your comrades while intercepting those of your enemy.",
        category: ["netgamesio", "hard"],
        players: "4+",
        familyFriendly: true,
    }),
];

export default games;
