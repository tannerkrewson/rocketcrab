import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "4inarow",
    name: "4 in a Row",
    author: "fravic",
    basedOn: {
        game: "Connect Four",
        link: "https://en.wikipedia.org/wiki/Connect_Four",
        bggId: 2719,
    },
    description:
        "A quick, easy board game in which two players compete to get four pieces in a line.",
    displayUrlText: "4inarow.onrender.com",
    displayUrlHref: "https://4inarow.onrender.com",
    category: ["easy"],
    players: "2",
    familyFriendly: true,
    minPlayers: 2,
    maxPlayers: 2,

    guideId: "4inarow",
    pictures: ["https://i.imgur.com/1Hhs3iQ.png"],

    getJoinGameUrl: async () => {
        const newGameUrl = "https://board-game-server.onrender.com/";
        const {
            data: {
                createGame: { roomCode },
            },
        } = await postJson(newGameUrl, {
            query: "mutation { createGame { roomCode } }",
            variables: null,
        });
        return {
            playerURL: "https://4inarow.onrender.com/g/" + roomCode,
        };
    },
};

export default game;
