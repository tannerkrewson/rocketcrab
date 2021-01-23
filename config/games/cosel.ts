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
        "A drawing version of the broken telephone game based on the game Telestrations. Try and communicate a word through a group of friends using drawings! It was made during the quarantine period of COVID-19 so that people could still play with their friends and family.",

    displayUrlText: "cosel.io",
    displayUrlHref: "https://cosel.io/",

    category: ["easy", "drawing"],

    players: "4+",

    familyFriendly: true,

    guideUrl: "https://cosel.io/how-to-play",

    pictures: [
        "https://i.imgur.com/qWRJ8VO.jpg",
        "https://i.imgur.com/SP0iRNQ.jpg",
        "https://i.imgur.com/7Ljm6kP.jpg",
        "https://i.imgur.com/0jblGmw.jpg",
        "https://i.imgur.com/EEHgiYM.jpg",
    ],

    connectToGame: async () => {
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
