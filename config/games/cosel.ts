import { ServerGame } from "../../types/types";

const game: ServerGame = {
    id: "cosel",
    name: "cosel.io",
    author: "Rob Farlow",

    basedOn: {
        game: "Telestrations",
        author: "USAopoly",
        link: "https://theop.games/products/game/telestrations-upside-drawn/",
    },

    description:
        "A drawing version of the broken telephone game. Try and communicate a word through a group of friends using drawings!",

    displayUrlText: "cosel.io",
    displayUrlHref: "https://cosel.io/",

    category: ["easy", "drawing"],

    players: "4+",

    familyFriendly: true,

    getJoinGameUrl: async () => {
        const res = await fetch("https://warhol.cosel.io/api/games", {
            method: "POST",
            headers: { sessionId: Math.random().toString(36).substring(7) },
        });
        const jsonRes = await res.json();

        return {
            playerURL: "https://cosel.io/game/" + jsonRes.game.hash,
        };
    },
};

export default game;
